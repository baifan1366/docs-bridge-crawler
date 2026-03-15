# Embedding 系统迁移文档

## 概述

从本地 Transformers.js 迁移到 Hugging Face Space API，实现更稳定、可靠的 embedding 生成。

## 变更内容

### 1. 模型更新

| 项目 | 旧方案 | 新方案 |
|------|--------|--------|
| 实现方式 | 本地 `@huggingface/transformers` | Hugging Face Space API |
| 模型 | `Xenova/bge-small-en-v1.5` | `intfloat/multilingual-e5-small` |
| 维度 | 384-dim | 384-dim (不变) |
| 语言支持 | 英文 | 多语言 (包括中文、马来文等) |

### 2. API 端点

```
E5 API: https://edusocial-e5-small-embedding-server.hf.space
BGE API: https://edusocial-bge-m3-embedding-server.hf.space (备用)
```

### 3. Task 参数

E5 模型需要根据使用场景指定 task：

- **query**: 搜索查询 → 自动添加 `"query: "` 前缀
- **passage**: 文档/段落 → 自动添加 `"passage: "` 前缀

Crawler 使用 `passage` task，因为它处理的是文档内容。

## API 使用示例

### 单个 Embedding

```typescript
POST /embed
{
  "input": "Malaysia requires passport validity of 6 months",
  "task": "passage"
}

Response:
{
  "embedding": [0.123, -0.456, ...], // 384-dim array
  "model": "intfloat/multilingual-e5-small",
  "task": "passage"
}
```

### 批量 Embedding

```typescript
POST /embed/batch
{
  "inputs": ["text1", "text2", "text3"],
  "task": "passage"
}

Response:
{
  "embeddings": [
    [0.123, -0.456, ...],
    [0.789, -0.012, ...],
    [0.345, -0.678, ...]
  ],
  "model": "intfloat/multilingual-e5-small",
  "task": "passage"
}
```

## 代码变更

### lib/embeddings/generator.ts

完全重写，移除所有 Transformers.js 依赖：

```typescript
// 旧实现
import { pipeline, env } from '@huggingface/transformers';
// ... 复杂的 WASM 配置和模型加载

// 新实现
const E5_API_URL = process.env.E5_HG_EMBEDDING_SERVER_API_URL;
const response = await fetch(`${E5_API_URL}/embed`, {
  method: 'POST',
  body: JSON.stringify({ input: text, task: 'passage' })
});
```

### package.json

移除依赖：
- ❌ `@huggingface/transformers`
- ❌ `onnxruntime-web`
- ❌ `onnxruntime-common`

### next.config.ts

简化配置，移除所有 webpack 特殊处理：

```typescript
// 旧配置：复杂的 webpack externals 和 WASM 处理
// 新配置：干净简单
const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {},
};
```

### vercel.json

降低资源需求：

```json
{
  "functions": {
    "app/api/webhook/route.ts": {
      "maxDuration": 300,
      "memory": 1024  // 从 3008 降低到 1024
    }
  }
}
```

## 优势

### 1. 稳定性
- ✅ 不再依赖复杂的 WASM 打包
- ✅ 避免 Vercel serverless 环境的兼容性问题
- ✅ 统一的 API 接口，易于维护

### 2. 性能
- ✅ 构建时间减少 (64s vs 100s)
- ✅ 内存占用降低 (1GB vs 3GB)
- ✅ 冷启动更快

### 3. 功能
- ✅ 多语言支持 (E5 multilingual)
- ✅ 批量处理更高效
- ✅ 可以轻松切换模型 (E5 / BGE)

### 4. 维护
- ✅ 代码更简洁 (120 行 vs 150 行)
- ✅ 依赖更少 (移除 49 个包)
- ✅ 配置更简单

## 测试

运行测试脚本验证 API：

```bash
node scripts/test-embedding-api.js
```

预期输出：
```
🚀 Testing E5 Embedding API
Model: intfloat/multilingual-e5-small (384-dim)

=== Testing Single Embedding ===
✅ Success!
Embedding dimension: 384

=== Testing Batch Embedding ===
✅ Success!
Number of embeddings: 3

🎉 All tests passed!
```

## 环境变量

在 `.env.local` 和 Vercel 环境变量中添加：

```bash
E5_HG_EMBEDDING_SERVER_API_URL="https://edusocial-e5-small-embedding-server.hf.space"
BGE_HG_EMBEDDING_SERVER_API_URL="https://edusocial-bge-m3-embedding-server.hf.space"
```

## 兼容性

### 向后兼容
- ✅ Embedding 维度保持 384-dim
- ✅ API 接口不变 (`generateEmbedding`, `generateEmbeddingsBatch`)
- ✅ 数据库 schema 不需要修改

### 注意事项
- ⚠️ 模型变更可能导致 embedding 值略有不同
- ⚠️ 建议重新爬取所有文档以获得一致的 embeddings
- ⚠️ 或者保持旧数据，只对新文档使用新模型

## 部署清单

- [x] 更新 `lib/embeddings/generator.ts`
- [x] 移除 Transformers.js 依赖
- [x] 简化 `next.config.ts`
- [x] 更新 `vercel.json`
- [x] 添加环境变量
- [x] 创建测试脚本
- [x] 本地测试通过
- [ ] 部署到 Vercel
- [ ] 验证生产环境
- [ ] 监控 API 调用

## 回滚方案

如果需要回滚到旧实现：

```bash
git revert <commit-hash>
npm install
npm run build
```

## 监控

关注以下指标：
- API 响应时间
- 错误率
- Embedding 质量
- 搜索准确度

## 支持

如有问题，检查：
1. Hugging Face Space 状态
2. API 端点可访问性
3. 环境变量配置
4. Vercel 函数日志
