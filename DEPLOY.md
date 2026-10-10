# 单词机账户版：部署说明

此目录是一份完整的 Vercel 项目：根目录 `index.html` 是前端，`api/` 和 `lib/` 是后端函数。它恢复邮箱+密码账户，移除匿名会话；每日免费额度和永久会员都绑定 Supabase 用户 ID。前端登录请求只访问本站 `/api/auth`，由 Vercel 服务端连接 Supabase。

## 先确认免费方案的边界

- 方案不使用短信，也不要求邮件验证码：在 Supabase 关闭 Email Confirmations 后，用户用邮箱地址和密码即可创建账号并登录。邮箱地址是登录名，不代表已验证身份。
- 一个邮箱只对应一个账户；同一人可以换邮箱再注册，所以无法证明“一个自然人只能有一个号”。需要手机号验证、人工审核或实名校验时，通常会产生费用或额外资质要求。
- 依赖 Vercel、Supabase、Upstash 的免费额度。免费额度、休眠/暂停策略会变化；超出额度后可能暂时不可用，不能承诺永久免费或商业 SLA。
- 你的网站有收费会员。Vercel Hobby 条款只允许个人/非商业使用，因此收费网站不能把 Hobby 免费计划视作合规的长期零成本商用方案；部署前确认当前 Vercel 项目计划允许商业用途。
- 通过 Vercel 代理可避免中国用户浏览器直接请求 Supabase，但仍不能保证 Vercel 域名和境外 Supabase 在所有大陆网络下始终稳定。
- 关闭邮箱验证意味着没有安全的邮箱找回流程。用户忘记密码时，当前版本无法自行重置；上线前应接受此限制，或另行配置邮件服务并开发密码重置功能。

## 部署完整项目

1. 解压整个项目，将**目录内所有文件**放进一个新的 GitHub 仓库根目录；不要只上传 `index.html`。
2. 在 Vercel 导入该仓库，部署到你正在使用的 `spanishpro.vercel.app` 项目/域名。前端默认使用本站域名调用 `/api/*`，无需改 API 地址。
3. 在 Vercel 的 Production Environment Variables 设置下列变量，然后重新部署。密钥只放在 Vercel，不要写进 HTML 或 GitHub。

| 变量 | 值 |
| --- | --- |
| `SUPABASE_URL` | 现有 Supabase 项目 URL |
| `SUPABASE_PUBLISHABLE_KEY` 或 `SUPABASE_ANON_KEY` | Supabase 的 publishable/anon key；兼容这两个变量名；不能填 service-role key |
| `UPSTASH_REDIS_REST_URL` | 现有 Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | 现有 Upstash REST token |
| `JIANPAY_GATEWAY` | 简付网关地址（沿用现有值） |
| `JIANPAY_CLIENT_NO` | 简付商户号（沿用现有值） |
| `JIANPAY_KEY` | 简付签名密钥（沿用现有值） |
| `ALLOW_ORIGIN` | `https://spanishpro.vercel.app,https://spanish123.kicp.fun`；只保留实际使用的站点域名也可以 |
| `SITE_URL` | 正式网站地址，例如 `https://spanishpro.vercel.app` |

现有 Supabase/Upstash/简付变量如已配置且值正确，无需重复创建。不要把任何 secret 发到聊天里。

## Supabase Auth 设置

1. 打开现有项目的 Authentication 设置，启用 Email provider。
2. 关闭 **Confirm email / Email confirmations**，这样注册不依赖 SMTP，用户注册后可直接登录。密码最短长度设为 8。
3. 将 Site URL 设为正式网站地址，并检查 Authentication URL Configuration 的允许重定向地址包含该正式地址。
4. 不要启用匿名登录；前端已不再发起匿名会话。

若保持邮箱验证开启，Supabase 默认邮件服务不会给任意新用户发信；需要另外配置 SMTP。那就不再是无需额外服务配置的零成本方案。

## 账户、额度与付款

- 新账号每日答对最多计 100 次，按中国标准时间午夜重置。错误答案不扣次数。
- 次数通过 Upstash 服务端原子递增并绑定 Supabase 用户 ID；不能靠改浏览器本地存储恢复额度。
- 简付订单记录和永久会员权益同样按 Supabase 用户 ID 绑定，换设备用同一账号登录可恢复。
- 前端只展示练习结果；次数和购买权益以服务端 Redis 记录为准。
- 这是针对正常网页流程的服务端额度，不是防作弊考试系统：答案判定仍在浏览器，用户若自行修改前端代码，可以绕开网页内的限制。要防技术用户绕过，必须把出题与答案判定也迁移到服务端，部署包当前没有做这项重构。
- 旧匿名会话中的次数不会自动迁移到账户。旧付款需要在简付后台核实后，由管理员单独给对应账户补发权益；不要让用户通过公开接口自行认领订单。

## 上线后检查

用一个新的邮箱注册并登录；刷新页面及换浏览器后检查账号仍可登录。答对一道题后检查今日计数只增加 1，输错不增加；在达到 100 次前不要用真实付款测试。支付需使用简付商户的测试能力或小额真实交易，并检查同一账号重新登录后仍显示永久解锁。

若遇到“账户服务尚未配置”，检查 Vercel Production 的 `SUPABASE_URL` 和 `SUPABASE_PUBLISHABLE_KEY` 是否设置后重新部署。若登录超时，先在大陆网络打开 `https://spanishpro.vercel.app/api/config`；`ok:true` 只证明 Vercel 配置存在，不能单独证明 Supabase Auth 网络请求畅通。
