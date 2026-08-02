import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  // GitHub Pages のリポジトリ名をベースパスに設定
  // ルートドメインの場合は '/' に変更
  base: '/ARmaps/',
  plugins: [basicSsl()],
  server: {
    host: true,
    port: 3000,
    https: true,
  },
});
