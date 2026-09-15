# 财务中心 T4 服务端同步设计

## 目标

将 T4 日损益数据从浏览器 `localStorage` 迁移到财务中心自己的服务端 SQLite 数据库，使员工 A 保存后员工 B 在同一主体、月份和渠道下可见。

## 范围

- T4 业务数据：月份、渠道、日期、收入/成本/费用明细、来源标记
- T4 参数与管理费分摊配置
- 读取、整月保存、并发版本号
- 旧浏览器数据一次性导入

不在本批：统一 SSO、细粒度角色权限、其他项目迁移。

## 架构

Nginx 继续提供静态页面；新增独立 Python 标准库 API 容器和持久化 SQLite 文件。Nginx 将 `/api/t4/data` 反代到 API 容器。API 只接受同源 JSON，不接触其他项目数据库。

## 数据模型

- `t4_periods(period, entity_id, data_json, cfg_json, version, updated_at, updated_by)`
- 唯一键：`(period, entity_id)`；第一版主体由前端当前主体 ID 传入
- 更新使用 `version` 乐观锁，版本不一致返回 409，避免员工互相覆盖

## 兼容与回滚

读取服务端无数据时回退本地数据；保存成功后服务端成为主数据源。本批不删除任何 localStorage。回滚只需停止 API 容器并恢复前端旧逻辑。

## 验证

1. API health 与读写接口
2. 两个浏览器上下文：A 保存，B 刷新可见
3. 版本冲突返回 409
4. Docker 重启后数据仍在
