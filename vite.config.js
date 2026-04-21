import {defineConfig} from "vite";

export default defineConfig({
  build: {
    rolldownOptions: {
      input: 'src/index.js',
      output: {
        entryFileNames: '[name].js',
        // minify: false
      }
    },
  },
})
