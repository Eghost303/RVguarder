const base=require('./playwright.config.cjs');
module.exports={...base,testMatch:'**/dsh-ui.spec.cjs',testIgnore:[],globalSetup:require.resolve('./setup/dsh-setup.cjs')};
