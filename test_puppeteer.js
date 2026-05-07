const puppeteer = require('puppeteer');

(async () => {
    // Try to find the existing Chrome instance by looking for CDPs or just run a new headless one against localhost
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto('http://localhost:8000/', { waitUntil: 'networkidle2' });
    
    // Evaluate expand click
    await page.waitForSelector('.btn-expand-stem');
    const logs = [];
    page.on('console', msg => logs.push(msg.text()));
    page.on('pageerror', err => logs.push('ERROR: ' + err.toString()));
    
    await page.click('.btn-expand-stem');
    await page.waitForTimeout(500);
    
    const isFullscreen = await page.$eval('.stem-track', el => el.classList.contains('is-fullscreen'));
    console.log('Class after click:', isFullscreen);
    console.log('Logs:', logs);
    
    await browser.close();
})();
