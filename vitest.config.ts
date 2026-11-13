import { defineConfig } from 'vitest/config';

// 逻辑层单元测试：只跑 tests 目录，Node 环境（逻辑层不依赖 DOM）
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
