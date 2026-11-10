const path=require('path');const appDir=process.env.MUSE_APP_DIR||path.resolve(__dirname,'../..');
module.exports={sourceRoot:process.env.MUSE_SOURCE_ROOT||appDir,internalProjectRoots:[],appDir};
