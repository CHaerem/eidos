import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
  },
  resolve: {
    alias: {
      'three/addons/loaders/OBJLoader.js': path.resolve(__dirname, 'tests/mocks/OBJLoader.js'),
      'three/addons/loaders/GLTFLoader.js': path.resolve(__dirname, 'tests/mocks/GLTFLoader.js'),
      'three/addons/loaders/DRACOLoader.js': path.resolve(__dirname, 'tests/mocks/DRACOLoader.js'),
      'three': path.resolve(__dirname, 'tests/mocks/three.js'),
    },
  },
});
