# Web

浏览器端 Builder，负责项目创建、Chat、Agent Activity、代码查看和 Preview 展示。它不接触模型密钥、项目磁盘或用户代码执行环境。

当前已接通项目列表、固定模板项目创建、文件读取、文件搜索、版本恢复、Chat Prompt、SSE Agent Activity 和 Preview iframe。页面只展示后端持久化的真实状态，不用伪进度。

## 开发

```bash
pnpm --filter @atoms/web dev
```
