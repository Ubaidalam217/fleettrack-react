import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.js'],
    setupFiles: ['./tests/setup.js'],

    /**
     * One process, one file at a time.
     *
     * Every test file truncates the database in beforeEach and then builds the
     * same fixture. Run two files concurrently against one database and each
     * one's truncate wipes the other's fixture mid-assertion — which produces
     * failures that move around between runs and say nothing about the code.
     *
     * The alternative (a database per worker) is worth it for a large suite; for
     * this one the whole run is a few seconds.
     */
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },

    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
