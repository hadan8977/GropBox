# GropBox · 传输助手

发给自己，在另一台设备继续。一个可以部署在 Vercel 的私人网页文件传输助手，不需要安装 exe，也不需要某台电脑持续开机。

技术路线：Next.js / React / TypeScript + Supabase PostgreSQL / Auth / Realtime + Google Drive。详细取舍见 [MVP 计划](docs/MVP_PLAN.md)。

## 当前功能与数据归属

- 全英文精简界面、单对话时间线、纯文本输入和截图粘贴、多文件选择/拖拽、历史分页、消息/笔记/附件名搜索、置顶、编辑和逻辑删除。
- 连续消息紧凑排列，间隔至少 5 分钟或跨天才显示时间。阅读历史时到达的新消息显示数量和跳转分隔，不强制跳到底部；提示仅限当前页面会话，不是跨设备持久化的已读回执。
- Liquid Glass 风格的悬浮窗口、侧栏和控件，跟随系统深浅色及减少动效/透明度偏好。浮动上传队列显示真实进度，支持图片大预览；没有局域网设备发现功能。
- 新建和编辑纯文本笔记，下载为 TXT。没有加粗、斜体、分点等富文本工具栏；已有 Markdown 记录保留原文和 MD 下载格式。历史富文本记录仍可显示，编辑时转为纯文本。
- 本机缓存与草稿、离线文字队列、失败重试、并发编辑冲突提示和另存；桌面与手机响应式页面，虚拟列表按需渲染历史。
- Drive 附件直传，最多 30 个附件、同时上传 2 个文件，分块大小 8 MiB；显示进度，支持暂停及重新选择原文件后续传。
- 数据库保存消息正文、附件元数据和查询索引；Drive 保存附件原件以及消息/文档的 JSON 版本归档。浏览器 IndexedDB 保存近期历史、待发内容和上传断点，不保存 Google token。
- Drive 首次需要写文件时创建“GropBox”，其下为“Files/YYYY-MM”“History”“Notes”。应用使用保存的 ID 定位目录，不使用名称作为身份；不要手工删除/移动应用目录，已删除到回收站的目录需要先恢复。
- Google 首次授权后，应用会话和 Drive access token 分别自动续期；不是永久免登录。Google refresh token 仅加密存储在服务端受限表。

消息右下角的勾选图标表示已写入 Supabase，云图标表示当前版本已归档到 Drive；完整状态可通过悬停提示或辅助技术读取。复制、置顶、编辑和删除在消息旁的“…”菜单中。附件先上传完成，再点击发送，接收端才会看到文件卡片。上传中的本机进度不会冒充其他设备已经收到文件。

## 配置并运行

需要 Node.js 22.12+、一个 Supabase 项目、Google Cloud OAuth Web 客户端；部署到 Vercel 时还需要部署者的 Vercel 账号。日常用户只需 Google 登录，不需要 Supabase 或 Vercel 账号。

### 1. Supabase

1. 创建专用于此应用的项目，选择靠近实际使用地点的区域；记下 Project URL、publishable key，以及仅供服务器使用的 secret key（旧项目的 service_role key 也可）。不要把管理密钥放进浏览器环境变量。
2. 在 SQL Editor 中执行 [001_gropbox.sql](supabase/migrations/001_gropbox.sql)。它用于新的应用数据库，执行一次；不要反复执行或未经检查地用于已有业务数据库。SQL 会创建表、索引、RLS、受限写入函数和消息实时发布，不会读取或改动 Drive 文件。
3. 在 Authentication → Providers 启用 Google，填写下一步得到的 Google client ID / secret。使用此 Google-only 登录方式时，不需要开启其他登录提供方。
4. 在 Authentication → URL Configuration 设置 Site URL 为网站地址，并把网站的完整回调地址加入 Redirect URLs，例如：

   - 本机：`http://localhost:3000/api/auth/callback`
   - 正式：`https://你的域名/api/auth/callback`

5. SQL 已把 `public.messages` 加入 `supabase_realtime` publication；在 Dashboard 检查启用状态。不要发布 `google_credentials` 或 `archive_jobs` 表。

### 2. Google Cloud

1. 创建项目并启用 Google Drive API，配置 OAuth 品牌、受众和必要的测试用户。
2. 创建 **Web application** 类型 OAuth 客户端，授权重定向 URI 填 Supabase 提供的地址：`https://你的项目标识.supabase.co/auth/v1/callback`。注意：这不是上一节网站自己的回调，两者都需要正确配置。
3. 使用基础身份权限及 `https://www.googleapis.com/auth/drive.file`；此应用不需要整个 Drive 的读写权限。它访问自己创建的文件，不会导入你原有全部硬盘内容。
4. 将同一组 Google client ID / secret 同时用于 Supabase Google provider 和应用环境变量；后台 Drive 续期必须使用签发原 refresh token 的客户端。
5. 外部应用仍为 Testing 且使用 Drive scope 时，refresh token 通常七天到期；正式长期使用需按 Google 要求调整发布/验证状态。即使浏览器已登录 Google，也仍需要第一次授权应用。

Google 官方说明：[Web 服务端授权](https://developers.google.com/identity/protocols/oauth2/web-server)、[令牌失效条件](https://developers.google.com/identity/protocols/oauth2)、[Drive 最小权限](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)。

### 3. 环境变量

将 [.env.example](.env.example) 复制为本机 `.env.local`，填写实际值；不要提交此文件。

| 变量 | 用途 |
| --- | --- |
| `APP_URL` | 网站固定源地址，本机为 `http://localhost:3000`，正式环境须 HTTPS |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 可公开的客户端 key，依靠 RLS 隔离数据 |
| `SUPABASE_SECRET_KEY` | 仅供服务端使用的 secret / service_role key |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 与 Supabase Google provider 一致 |
| `TOKEN_ENCRYPTION_KEY` | 64 位十六进制字符，即 32 随机字节，用于 AES-256-GCM 凭据加密 |
| `CRON_SECRET` | 独立随机密钥，保护日级归档任务 |
| `ALLOWED_GOOGLE_EMAILS` | 可选，逗号分隔的登录/API 账号白名单；个人部署建议填写自己的邮箱 |

生成随机值的命令（分别运行两次，输出只粘贴到自己的环境配置中）：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

保持 `TOKEN_ENCRYPTION_KEY` 稳定。丢失/直接替换会导致已有 Google 凭据无法解密，需要相关用户重新连接；不会因此删除消息或 Drive 文件。不要把真实密钥发到聊天、Issue 或日志。

白名单用于登录和服务端 API 准入；若要停用已经接入的用户，还需在 Supabase 将其 `app_accounts.active` 设为 `false`，RLS 会停止其在线数据访问。仅从环境白名单移除不是撤销已签发令牌或抹除用户本机缓存。

### 4. 本机运行或 Node.js 自托管

Windows PowerShell 与 Linux 均在项目目录运行：

```sh
npm ci
npm run dev
```

访问 `http://localhost:3000`。未配置全部服务时展示配置说明，不模拟登录或发送成功。

生产运行使用 `npm run build` 后 `npm start`。自托管需另配 HTTPS 反向代理，设置正确 `APP_URL`；Supabase 和 Drive 仍是托管服务，不依赖本机数据库文件。本项目不提供 exe。

### 5. Vercel

导入项目源码，Framework 选择 Next.js，安装命令 `npm ci`，构建命令 `npm run build`。配置上述环境变量，把 `APP_URL` 改为最终 HTTPS 域名，并同步更新 Supabase Site URL / Redirect URLs。

公开环境变量会进入构建后的客户端，修改后需要重新部署。Preview 使用独立且精确匹配的回调/环境配置，不用宽泛通配符放开 OAuth 回调。需要访问数据库的 Vercel 函数区域尽量靠近 Supabase 区域。

[vercel.json](vercel.json) 配置每天一次的归档补偿任务；设置 `CRON_SECRET` 后由 Vercel 自动附带授权头。正常在线使用也会触发短批次归档，每批最多 5 项，失败持久化保留并退避重试。日任务不是聊天同步通道，大量积压可能需要多个批次；未配置 Cron、授权失效、数据库暂停或配额不足时不能保证无人在线仍及时归档。[Vercel Cron 限制](https://vercel.com/docs/cron-jobs/usage-and-pricing)

附件的字节不经过 Vercel Function 或 Supabase Storage。Vercel 的 5 GB Large Functions Beta 是函数包大小，不是附件上传限制。代码支持大文件分块，但真实 5 GB 上传、跨运营商速度、Google 配额与浏览器后台行为仍需实测。[Vercel 函数限制](https://vercel.com/docs/functions/limitations)

## 使用边界

- Supabase 免费项目闲置一周可能暂停；500 MB 数据库额度包括消息、索引和归档操作记录。免费套餐不适合承诺永久随时可用；不闲置暂停的 Pro 当前从 $25/月起。商业运营也需要核对 Vercel Hobby 的用途限制。[Supabase 定价](https://supabase.com/pricing)
- 默认删除只隐藏时间线记录，不删除 Drive 附件和既有 JSON 归档；这不是彻底清除全部副本。归档保存操作 ID 和版本，不能在 Drive 直接编辑后双向回写；不提供自动整库恢复工具。
- 搜索为字面子串匹配，覆盖在线数据库的消息文字、标题和文件名；一次最多显示 100 条。中文可查，短关键词可能扫描更多数据；不包含附件正文、OCR 或语义搜索。
- 笔记仅支持纯文本编辑。编辑期间保留本机草稿，点击 Save 才进入跨设备同步队列；同时编辑的冲突会保留本机版本供复制/另存。
- WebSocket 不通时，前台约每 4 秒轮询。正常实时连接下也定期补查；重复同步优先读取轻量版本信息，只重新获取变更正文。后台页面可能被系统挂起。
- 已打开的页面断网后可写草稿、排队文字；**完全离线刷新/冷启动目前显示离线入口**，需联网重新加载应用后继续。PWA 分享接收目前限文本/链接；手机文件通过系统文件选择器上传，锁屏持续上传不保证。
- 预览只接收限定图片类型并限制实际读取字节；SVG/HTML 不会作为网页代码执行。大文件下载使用浏览器流式保存，不支持时打开 Drive 页面；系统文件分享受浏览器能力限制。
- 退出当前设备清除本机缓存、草稿和断点，不注销其他设备或删除云端内容；已有 access token 不能保证立即失效。
- 这不是端到端加密产品。消息正文对有权限的数据库管理员可读；加密 Google 凭据的密钥位于服务端环境。只用于有权传输的内容，不绕过公司访问/数据防护策略。

## 验证

```sh
npm test
npm run build
```

`npm test` 覆盖领域校验、令牌续期与 Cookie 剥离、分块上传边界、预览内存限制，以及 PGlite 中运行的 PostgreSQL 迁移/RLS/事务测试。生产构建包含 TypeScript 检查；PGlite 不是已经部署的 Supabase。

浏览器测试：安装 Playwright Chromium 后 `npm run test:e2e`；本机已有 Chrome 时可直接使用：

```powershell
# Windows PowerShell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm run test:e2e
```

```sh
# Linux，已有 Chrome 时
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

浏览器测试自己启动 3100 端口的服务，Google/Supabase 网络请求仅在测试中替换为假数据；测试配置不提供生产登录绕过开关。它们验证页面、离线队列、两个浏览器同步、附件路径、纯文本笔记、下载、输入法和键盘操作。手机项目是 Chromium 移动视口模拟，不等于 iOS Safari 真机验证。

真实部署后的 OAuth、RLS/Realtime、公司网络、手机和 5 GB 文件需要实际账号与设备联调。没有这些证据，不将“P95 两秒内同步”或“大文件真实上传成功”写成已达成结果。

界面参考：[Apple Design Skill](https://github.com/naplesblue/apple-design-skill)、[Liquid Glass Design System](https://github.com/claudiusnoc/liquid-glass-design-system)、[Awesome Liquid Glass](https://github.com/GetStream/awesome-liquid-glass)。采用灰白、单一蓝色强调和弹层毛玻璃，不模拟原生 iOS 系统控件。品牌已改为 GropBox；内部持久化标识保持稳定，避免已有浏览器草稿或 Drive 文件失联。
