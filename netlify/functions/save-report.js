exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const payload = JSON.parse(event.body);
    const { password, content } = payload;

    const envPassword = process.env.EDIT_PASSWORD;
    if (!envPassword) {
      return { statusCode: 500, body: 'Server Error: EDIT_PASSWORD environment variable is not set in Netlify.' };
    }

    // Verify password against Netlify environment variables (trimming accidental spaces)
    if (password.trim() !== envPassword.trim()) {
      return { statusCode: 401, body: 'Unauthorized: Incorrect Password' };
    }

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    if (!GITHUB_TOKEN) {
      return { statusCode: 500, body: 'Server Error: GITHUB_TOKEN not configured.' };
    }

    const REPO = 'sudsw12/music159finalproject';
    const FILE_PATH = 'report.html';

    // 1. Get the current file's SHA from GitHub
    const getRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      headers: { 
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Netlify-Editor'
      }
    });
    
    if (!getRes.ok) {
      const errorText = await getRes.text();
      return { statusCode: 500, body: `Failed to fetch current file from GitHub. Status: ${getRes.status}. Details: ${errorText}` };
    }

    const fileData = await getRes.json();
    const sha = fileData.sha;

    // 2. Commit the new file to GitHub
    const putRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      method: 'PUT',
      headers: { 
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Netlify-Editor'
      },
      body: JSON.stringify({
        message: 'docs: update report content via live site editor',
        content: Buffer.from(content, 'utf-8').toString('base64'),
        sha: sha
      })
    });

    if (!putRes.ok) {
      const err = await putRes.text();
      return { statusCode: 500, body: `GitHub API Error: ${err}` };
    }

    return { 
      statusCode: 200, 
      body: JSON.stringify({ success: true, message: 'Successfully committed to GitHub!' })
    };
  } catch (err) {
    return { statusCode: 500, body: err.toString() };
  }
};
