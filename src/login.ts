/*
 * File: login.ts
 * Project: deepsproxy
 * Author: Pedro Farias
 * Created: 2026-05-09
 * 
 * Last Modified: Sat May 09 2026
 * Modified By: Pedro Farias
 */

import { initPlaywright, closePlaywright, activePage, exportStorageState } from './services/playwright.ts';

async function main() {
  console.log('Opening DeepSeek to allow login...');
  await initPlaywright(false); // false = not headless
  if (activePage) {
    await activePage.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
  } else {
    console.error('Failed to get active page');
    process.exit(1);
  }
  console.log('Browser opened. Please login to chat.deepseek.com.');
  console.log('Once you are fully logged in and can see the chat interface, press Ctrl+C here to export storage-state.json.');
  
  // Wait indefinitely until user closes the process
  process.on('SIGINT', async () => {
    try {
      await exportStorageState(process.env.STORAGE_STATE_FILE || 'storage-state.json');
      console.log(`Saved ${process.env.STORAGE_STATE_FILE || 'storage-state.json'}`);
    } catch (error: any) {
      console.error('Could not export storage state:', error?.message || error);
    }
    console.log('Closing browser...');
    await closePlaywright();
    process.exit(0);
  });
}

main();
