# Contributing

## 开发

要求 Node `^22.19.0 || >=24.0.0`。插件是纯 ESM、零运行时依赖，不需要构建。

```powershell
git clone <repo-url> dsh-personal-context
cd dsh-personal-context
node test/smoke.mjs
```

把目录安装进 DSH 时，用 `plugin_manager install_bundle` 指向该目录；Host 代码改动后需要禁用/启用插件或重启 DSH，`client.js` 改动刷新页面即可。

## 提交前

```powershell
node test/smoke.mjs
node --check index.js
node --check client.js
node --check lib/service.js
node --check scripts/import-archive.mjs
```

## 约束

- 不引入 npm 运行时依赖；客户端 React 从 DSH 浏览器模块表获取。
- 所有会改变记忆的入口必须复用 `PersonalContextService`，不要在 UI/工具里复制业务逻辑。
- 写入必须保持 Markdown + HTML 注释协议向后兼容；新字段要能缺省读取。
- 不提交真实记忆、备份、导出、`settings.json`、`state.json`、`Memory/` 或任何个人档案。
- 测试使用临时目录与合成数据，不读取用户真实知识库。
- 新增记录类型、协议字段或 Host 事件时，同步更新 `README.md`、`docs/DETAIL.md` 和 `CHANGELOG.md`。
