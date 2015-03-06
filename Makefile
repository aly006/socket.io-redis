
test:
	@./node_modules/.bin/mocha
convert:
	babel lib --out-dir node

.PHONY: test
