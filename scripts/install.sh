
# using clang on linux causes
# Error: /usr/lib/x86_64-linux-gnu/libstdc++.so.6: version `GLIBCXX_3.4.20' not found

if [ $TRAVIS_OS_NAME == "linux" ]; then
  export CC=/usr/bin/gcc-4.8
  export CXX=/usr/bin/g++-4.8
  export npm_config_clang=0
else
  export CC=clang
  export CXX=clang++
  export npm_config_clang=1
fi

nvm unload || true
rm -rf ./__nvm/ && git clone --depth 1 https://github.com/creationix/nvm.git ./__nvm
source ./__nvm/nvm.sh
nvm install ${NODE_VERSION}
nvm use ${NODE_VERSION}
node --version
npm --version
which node

if [ "$RUNTIME" == "electron" ]; then
  echo "Building electron $TARGET"
  export npm_config_target=$TARGET
  export npm_config_arch=$TARGET_ARCH
  export npm_config_target_arch=$TARGET_ARCH
  export npm_config_disturl=https://atom.io/download/electron
  export npm_config_runtime=electron
  export npm_config_build_from_source=true
fi

if [ -z "$TARGET" ]; then
  export TARGET=$(node -v | sed -e '1s/^.//')
fi

HOME=~/.electron-gyp npm install --build-from-source
