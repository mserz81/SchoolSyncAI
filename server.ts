import express, { Request, Response, NextFunction } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { google } from "googleapis";
import cookieParser from "cookie-parser";
import session from "express-session";
import cors from "cors";
import dotenv from "dotenv";
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "./firebase-applet-config.json" assert { type: "json" };

dotenv.config();

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: firebaseConfig.projectId,
  });
}

const firestore = firebaseConfig.firestoreDatabaseId 
  ? getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId)
  : getFirestore(admin.app());

const app = express();
const PORT = 3000;

// Extend Request type for Firebase Auth
interface AuthRequest extends Request {
  user?: admin.auth.DecodedIdToken;
}

// Middleware to verify Firebase ID Token
const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// OAuth2 client setup
const getRedirectUri = () => {
  const baseUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  return `${baseUrl}/auth/callback`;
};

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email'
];

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'school-sync-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: true, 
    sameSite: 'none',
    httpOnly: true
  }
}));

// Helper to get Google tokens for a user
async function getGoogleTokens(uid: string) {
  const tokenDoc = await (await firestore).collection('server_tokens').doc(uid).get();
  if (!tokenDoc.exists) {
    throw new Error('Google account not connected');
  }
  return tokenDoc.data();
}

// API Routes
app.get("/api/auth/url", (req, res) => {
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: 'UID is required' });

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    getRedirectUri()
  );
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: uid as string
  });
  res.json({ url: authUrl });
});

app.get("/auth/callback", async (req, res) => {
  const { code, state: uid } = req.query;
  if (!uid || !code) return res.status(400).send("Missing parameters");

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      getRedirectUri()
    );
    const { tokens } = await oauth2Client.getToken(code as string);
    
    // Store tokens securely in Firestore (server-side only)
    await (await firestore).collection('server_tokens').doc(uid as string).set(tokens);

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error exchanging code for tokens:", error);
    res.status(500).send("Authentication failed");
  }
});

// Gmail API - List messages
app.post("/api/gmail/list", authenticate, async (req: AuthRequest, res) => {
  const { query, pageToken, maxResults } = req.body;
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const tokens = await getGoogleTokens(uid);
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      getRedirectUri()
    );
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query || 'label:inbox',
      pageToken: pageToken,
      maxResults: maxResults || 20
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Gmail API - Get message details
app.post("/api/gmail/message", authenticate, async (req: AuthRequest, res) => {
  const { messageId } = req.body;
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const tokens = await getGoogleTokens(uid);
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      getRedirectUri()
    );
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Calendar API - Create event
app.post("/api/calendar/create", authenticate, async (req: AuthRequest, res) => {
  const { event } = req.body;
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const tokens = await getGoogleTokens(uid);
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      getRedirectUri()
    );
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Calendar API - List events
app.post("/api/calendar/list", authenticate, async (req: AuthRequest, res) => {
  const { timeMin, timeMax } = req.body;
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const tokens = await getGoogleTokens(uid);
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      getRedirectUri()
    );
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Drive API - Ensure Folder Exists
app.post("/api/drive/ensure-folder", authenticate, async (req: AuthRequest, res) => {
  const { folderName } = req.body;
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const tokens = await getGoogleTokens(uid);
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      getRedirectUri()
    );
    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Search for folder
    const searchResponse = await drive.files.list({
      q: `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      return res.json({ folderId: searchResponse.data.files[0].id });
    }

    // Create folder if not found
    const createResponse = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      },
      fields: 'id'
    });

    res.json({ folderId: createResponse.data.id });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Drive API - Save URL to Drive
app.post("/api/drive/save-url", authenticate, async (req: AuthRequest, res) => {
  const { url, fileName, folderId } = req.body;
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const tokens = await getGoogleTokens(uid);
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      getRedirectUri()
    );
    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Fetch the file from URL
    const fileResponse = await fetch(url);
    if (!fileResponse.ok) throw new Error(`Failed to fetch file from URL: ${fileResponse.statusText}`);
    
    const contentType = fileResponse.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await fileResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: folderId ? [folderId] : []
      },
      media: {
        mimeType: contentType,
        body: buffer
      }
    });

    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Drive API - Upload file
app.post("/api/drive/upload", authenticate, async (req: AuthRequest, res) => {
  const { fileMetadata, media } = req.body;
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const tokens = await getGoogleTokens(uid);
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      getRedirectUri()
    );
    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType: media.mimeType,
        body: Buffer.from(media.data, 'base64')
      }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Delete user data (GDPR compliance)
app.post("/api/user/delete", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    console.log(`Starting data deletion for user: ${uid}`);

    const batch = firestore.batch();

    // 1. Delete user profile
    const userRef = firestore.collection('users').doc(uid);
    batch.delete(userRef);

    // 2. Delete user tokens
    const tokensRef = firestore.collection('server_tokens').doc(uid);
    batch.delete(tokensRef);

    // 3. Delete user events (need to find them first)
    const eventsSnapshot = await firestore.collection('events')
      .where('userId', '==', uid)
      .get();
    
    eventsSnapshot.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();

    // 4. Delete Firebase Auth account
    await admin.auth().deleteUser(uid);

    console.log(`Successfully deleted all data for user: ${uid}`);
    res.json({ success: true, message: 'All user data and account deleted successfully.' });
  } catch (error) {
    console.error('Error deleting user data:', error);
    res.status(500).json({ error: 'Failed to delete user data' });
  }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
