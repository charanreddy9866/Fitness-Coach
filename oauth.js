const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = 'https://fitness-coach-dashboard.vercel.app/auth/callback';

app.post('/api/auth/discord', async (req, res) => {
  const { code } = req.body;

  try {
    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', {
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      scope: 'identify',
    });

    const { access_token } = tokenResponse.data;

    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const { id, username } = userResponse.data;

    res.json({
      success: true,
      user: { id, username },
      token: access_token,
    });
  } catch (error) {
    console.error('OAuth error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`OAuth handler listening on port ${PORT}`));
