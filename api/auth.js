/**
 * Vercel Serverless Function: Autentikasi Akses DIASAP POS
 * Memverifikasi password kasir terhadap environment variable APP_PASSWORD
 */

export default function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }

        const { password } = body || {};
        const correctPassword = process.env.APP_PASSWORD || 'syalala123';

        if (password && password === correctPassword) {
            return res.status(200).json({
                success: true,
                message: 'Akses diterima',
                token: 'dsp_auth_' + Buffer.from(Date.now().toString()).toString('base64')
            });
        }

        return res.status(401).json({
            success: false,
            message: 'Password salah. Silakan coba lagi.'
        });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error: ' + err.message });
    }
}
