# 开源发布检查清单

## 仓库

- [ ] 确定 GitHub 组织或个人账号。
- [ ] 创建远端仓库 `codex-lark`。
- [ ] 替换 README 中的 `<your-repository-url>`。
- [ ] 设置仓库描述、Topics 和默认分支保护。
- [ ] 确认 MIT License 与最终发布意图一致。

## 安全

- [ ] 在 `SECURITY.md` 填写私密漏洞报告邮箱。
- [ ] 运行 `npm run check:public`。
- [ ] 人工检查首个 commit，不包含 `.env`、Lark ID、日志、附件、Codex transcript 或私有 Skill。
- [ ] 用全新用户和最小权限飞书应用做一次干净安装测试。

## 产品体验

- [x] 中文 README。
- [x] 英文 README。
- [x] 脱敏进度卡界面示意。
- [x] 权限矩阵和一键安装命令。
- [ ] 发布后替换为真实仓库 clone URL。
- [ ] 可选：录制真实飞书交互 GIF，确保无个人信息。

## 发布

- [ ] 创建首个本地 commit。
- [ ] 推送 `main`，确认 GitHub Actions 通过。
- [ ] 创建 `v0.1.0` tag 和 Release Notes。
- [ ] 在另一台机器按 README 从零安装并完成 smoke test。
