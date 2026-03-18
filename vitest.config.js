import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
  },
  resolve: {
    alias: {
      'three/addons/loaders/OBJLoader.js': path.resolve(__dirname, 'tests/mocks/OBJLoader.js'),
      'three': path.resolve(__dirname, 'tests/mocks/three.js'),
    },
  },
});
