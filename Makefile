
test:
	@./node_modules/.bin/mocha
convert:
	6to5 lib --out-dir node

.PHONY: test
