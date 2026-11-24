# Creative Passport：第一、二步交付说明

## 已完成

- 独立 `feature/creative-passport` 分支，原项目的 Python 实验工具和旧产品页面保留。
- 新增项目与商品关联、来源与人工确认的事实、不可覆盖的 Spec 快照、B0/B1 创意及修订记录。原始来源只能新增；确认过的创意证据关联锁定，后续改动新建修订。
- 广告草稿独立采用 Campaign → Ad Group → Ad。Campaign 管目标、目的地和预算策略；Ad Group 管定向、排期、出价及组级预算；Ad 管身份、文案、链接及素材关联。这里保存本地草稿，未接入 TikTok 投放 API。
- 日预算和总预算分别使用 DAILY / LIFETIME；数据库检查预算层级、金额及结束时间。
- 墨西哥使用 MX / es-MX；旧“欧洲”“东南亚”保留原记录并标记待确认，不猜测国家或语言。旧生成流程允许单一市场。

## 数据迁移

迁移文件：`supabase/migrations/202611240001_creative_passport_foundation.sql`，依赖原有两份迁移，按文件名顺序执行。

当前仅在本地 PostgreSQL 引擎 PGlite 的隔离数据库中验证，尚未对线上 Supabase 执行。将来先备份测试项目，执行迁移后以两个测试账号检查 RLS、旧商品/创意页面、一次 Spec 编辑和一次真实生成，再决定生产环境迁移。同时核对托管库默认权限，明确撤销不需要的 TRUNCATE 等 SQL 权限。PGlite 的 auth/storage 是测试边界，不能替代托管 Supabase 验证。

旧 `campaigns` 仍是创意批次，不迁移成投放 Campaign。只回填实际存在的最新版 Spec；旧批次引用已丢失的版本时，`legacy_creative_batches.spec_history_status` 显示 unavailable，不伪造历史。已存在历史的商品不能删除当前 Spec 后重新从 v1 抽取；原记录已丢失时需要恢复原数据或新建商品。Spec 保存携带编辑时的版本号，过期提交返回 409。

## 配置与检查

本地配置放在 `product-app/.env.local`，从 `.env.example` 复制。该文件已被 Git 忽略；Supabase URL 与 anon key 是浏览器配置，模型 API key 只供服务端读取。默认关闭付费模型功能。部署时在托管平台填写环境变量，不上传这个文件。

在 `product-app` 中运行：

```bash
npm ci
npm run lint
npm test
```

`npm test` 统一使用空外部配置并关闭付费调用，先执行生产构建，再测试迁移、权限、历史版本、市场映射、预算约束和原有产品逻辑。真实登录、邮件及模型调用需要单独的测试项目配置。本步骤尚未增加完整新工作流 UI，也未部署网站。

## 本次验证范围

生产构建通过，50/50 自动化测试通过。删除完整项目、商品和账号的级联清理均有回归测试；Ad 与素材的市场一致性由复合外键保护。Spec 测试让两个请求读取同一版本后竞争更新，但这不等于独立连接的 PostgreSQL 并发压测。托管环境的双连接检查仍待后续接入测试库完成。
