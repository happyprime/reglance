import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const config = JSON.parse(await readFile('config.json', 'utf8'));
const PORT = config.defaults?.port || 3030;
const ROOT = new URL('./', import.meta.url).pathname;

const MIME = {
	'.html': 'text/html',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.json': 'application/json',
};

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://localhost:${PORT}`);
	const filePath = join(ROOT, decodeURIComponent(url.pathname));

	// Prevent directory traversal
	if (!filePath.startsWith(ROOT)) {
		res.writeHead(403);
		res.end('Forbidden');
		return;
	}

	// Redirect root to reports directory
	if (url.pathname === '/') {
		res.writeHead(302, { Location: '/reports/' });
		res.end();
		return;
	}

	try {
		const info = await stat(filePath);

		if (info.isDirectory()) {
			// Serve directory listing
			const files = await readdir(filePath);
			const links = files
				.sort()
				.reverse()
				.map(
					(f) =>
						`<li><a href="${encodeURIComponent(f)}">${f}</a></li>`
				)
				.join('\n');
			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.end(`<!DOCTYPE html>
<html><head><title>Reports</title>
<style>body{font-family:system-ui;max-width:800px;margin:2rem auto;padding:0 1rem}a{color:#0366d6}li{margin:0.3rem 0}</style>
</head><body><h1>Reports</h1><ul>${links}</ul></body></html>`);
			return;
		}

		const content = await readFile(filePath);
		const mime = MIME[extname(filePath)] || 'application/octet-stream';
		res.writeHead(200, { 'Content-Type': mime });
		res.end(content);
	} catch {
		res.writeHead(404);
		res.end('Not found');
	}
});

server.listen(PORT, () => {
	console.log(
		`Serving at http://localhost:${PORT} (reports at http://localhost:${PORT}/reports/)`
	);
});
