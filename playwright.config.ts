/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: 2,
  timeout: 90000,
  projects: [
    { name: 'unit', testMatch: /(?:build|config|render|legacy\.render|command-chain)\.spec\.ts/ },
    { name: 'chromium', testMatch: /(?:browser|events|integration)\.spec\.ts/, use: { browserName: 'chromium' } },
    { name: 'firefox', testMatch: /(?:browser|events)\.spec\.ts/, use: { browserName: 'firefox' } },
  ],
  reporter: 'list',
});
