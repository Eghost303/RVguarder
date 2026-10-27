const base=require('./playwright.config.cjs');
// 本机回归使用系统 Chrome（channel: chrome）；Firefox 需 `npm run install:browsers` 后恢复。
module.exports={...base,testMatch:'**/dsh-ui.spec.cjs',testIgnore:[],globalSetup:require.resolve('./setup/dsh-setup.cjs'),
  projects:[{name:'chromium',use:{...base.projects[0].use,channel:'chrome'}}]};
