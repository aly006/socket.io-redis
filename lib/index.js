/**
 * Module dependencies.
 */

import uid2 from 'uid2';
import { createClient as redis } from 'redis';
import msgpack from 'msgpack-js';
import Adapter from 'socket.io-adapter';
import { EventEmitter as Emitter } from 'events';
import debug from 'debug';
debug('socket.io-redis');
import async from 'async';

/**
 * Module exports.
 */

export default function adapter(uri, opts) {
  opts = opts || {};

  // handle options only
  if ('object' == typeof uri) {
    opts = uri;
    uri = null;
  }

  // handle uri string
  if (uri) {
    uri = uri.split(':');
    opts.host = uri[0];
    opts.port = uri[1];
  }

  // opts
  let host = opts.host || '127.0.0.1';
  let port = Number(opts.port || 6379);
  let pub = opts.pubClient;
  let sub = opts.subClient;
  let prefix = opts.key || 'socket.io';

  // init clients if needed
  if (!pub) pub = redis(port, host);
  if (!sub) sub = redis(port, host, { detect_buffers: true });

  // this server's key
  let uid = uid2(6);
  let key = prefix + '#' + uid;

 /**
  * Returns a redis Adapter class.
  *
  * @param {String} optional, redis uri
  * @return {RedisAdapter} adapter
  * @api public
  */
  class Redis extends Adapter {
    /**
     * Adapter constructor.
     *
     * @param {String} namespace name
     * @api public
     */

     constructor(nsp){
      super(nsp);

      this.uid = uid;
      this.prefix = prefix;
      this.pubClient = pub;
      this.subClient = sub;

      let self = this;
 
      sub.subscribe(prefix + '#' + nsp.name + '#', function(err){
        if (err) self.emit('error', err);
      });
      sub.on('message', this.onmessage.bind(this));
    }

    /**
     * Called with a subscription message
     *
     * @api private
     */

    onmessage(channel, msg){
      let pieces = channel.split('#');
      let args = msgpack.decode(msg);
      let packet;

      if (uid == args.shift()) return debug('ignore same uid');

      packet = args[0];

      if (packet && packet.nsp === undefined) {
        packet.nsp = '/';
      }

      if (!packet || packet.nsp != this.nsp.name) {
        return debug('ignore different namespace');
      }

      args.push(true);

      this.broadcast.apply(this, args);
    }


    /**
     * Broadcasts a packet.
     *
     * @param {Object} packet to emit
     * @param {Object} options
     * @param {Boolean} whether the packet came from another node
     * @api public
     */

    broadcast(packet, opts, remote){
      super.broadcast(packet, opts);
      if (!remote) {
        if (opts.rooms) {
          opts.rooms.forEach(function(room) {
            let chn = prefix + '#' + packet.nsp + '#' + room + '#';
            let msg = msgpack.encode([uid, packet, opts]);
            pub.publish(chn, msg);
          });
        } else {
          let chn = prefix + '#' + packet.nsp + '#';
          let msg = msgpack.encode([uid, packet, opts]);
          pub.publish(chn, msg);
        }
      }
    }

   /**
     * Subscribe client to room messages.
     *
     * @param {String} client id
     * @param {String} room
     * @param {Function} callback (optional)
     * @api public
     */

    add(id, room, fn){
      debug('adding %s to %s ', id, room);
      let self = this;
      this.sids[id] = this.sids[id] || {};
      this.sids[id][room] = true;
      this.rooms[room] = this.rooms[room] || {};
      this.rooms[room][id] = true;
      let channel = prefix + '#' + this.nsp.name + '#' + room + '#';
      sub.subscribe(channel, function(err){
        if (err) {
          self.emit('error', err);
          if (fn) fn(err);
          return;
        }
        if (fn) fn(null);
      });
    }

    /**
     * Unsubscribe client from room messages.
     *
     * @param {String} session id
     * @param {String} room id
     * @param {Function} callback (optional)
     * @api public
     */

    del(id, room, fn){
      debug('removing %s from %s', id, room);

      let self = this;
      this.sids[id] = this.sids[id] || {};
      this.rooms[room] = this.rooms[room] || {};
      delete this.sids[id][room];
      delete this.rooms[room][id];

      if (this.rooms.hasOwnProperty(room) && !Object.keys(this.rooms[room]).length) {
        delete this.rooms[room];
        let channel = prefix + '#' + this.nsp.name + '#' + room + '#';
        sub.unsubscribe(channel, function(err){
          if (err) {
            self.emit('error', err);
            if (fn) fn(err);
            return;
          }
          if (fn) fn(null);
        });
      } else {
        if (fn) process.nextTick(fn.bind(null, null));
      }
    }


    /**
     * Unsubscribe client completely.
     *
     * @param {String} client id
     * @param {Function} callback (optional)
     * @api public
     */

    delAll(id, fn){
      debug('removing %s from all rooms', id);

      let self = this;
      let rooms = this.sids[id];

      if (!rooms) return process.nextTick(fn.bind(null, null));

      async.forEach(Object.keys(rooms), function(room, next){
        if (rooms.hasOwnProperty(room)) {
          delete self.rooms[room][id];
        }

        if (self.rooms.hasOwnProperty(room) && !Object.keys(self.rooms[room]).length) {
          delete self.rooms[room];
          let channel = prefix + '#' + self.nsp.name + '#' + room + '#';
          return sub.unsubscribe(channel, function(err){
            if (err) return self.emit('error', err);
            next();
          });
        } else {
          process.nextTick(next);
        }
      }, function(err){
        if (err) {
          self.emit('error', err);
          if (fn) fn(err);
          return;
        }
        delete self.sids[id];
        if (fn) fn(null);
      });
    }
  }

  return Redis;
}
