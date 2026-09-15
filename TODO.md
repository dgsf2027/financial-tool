# T4 服务端同步 TODO

- [x] SQLite workspace API：WAL、事务、版本号、字段冲突、审计 revision
- [x] 静态服务器反代 `/api/t4/workspace`
- [x] 前端加载/保存接服务端；远端状态不再被旧 localStorage 覆盖；保存失败不提示成功
- [x] 隔离数据库 + 双浏览器端口真测：A 写入、B 读取、B 刷新后保留
- [x] 接入 fail-closed 门户 SSO 回调骨架（无配置时 401）
- [ ] 门户将 finance 从 `ssoProtocol=0` 切换到授权码协议，并确定可读写员工范围
- [ ] 旧 localStorage 数据备份、预览、冲突提示、显式导入
- [ ] 生产独立 SQLite 卷、备份策略、灰度部署和重启后真测
- [ ] 其余本地部署项目逐个核验真实写入路径
