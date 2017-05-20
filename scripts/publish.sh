if [ -z "$TARGET" ]; then
  ./node_modules/.bin/node-pre-gyp package
  ./node_modules/.bin/node-pre-gyp publish
else
  ./node_modules/.bin/node-pre-gyp package --runtime=$RUNTIME --target=$TARGET
  ./node_modules/.bin/node-pre-gyp publish --runtime=$RUNTIME --target=$TARGET
fi
