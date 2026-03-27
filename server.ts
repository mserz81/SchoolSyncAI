import express, { Request, Response, NextFunction } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { google } from "googleapis";
import cookieParser from "cookie-parser";
import session from "express-session";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "./firebase-applet-config.json" assert { type: "json" };

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET!;
const SESSION_SECRET = process.env.SESSION_SECRET!;
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

// Initialize Firebase Admin
if (!admin.apps.length) {
  console.log('Initializing Firebase Admin for project:', firebaseConfig.projectId);
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: firebaseConfig.projectId,
  });
}

const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
console.log('Using Firestore Database ID:', databaseId);
const firestore = getFirestore(databaseId);

// Test connection at startup
(async () => {
  try {
    console.log('Testing Firestore connection...');
    await firestore.collection('system_check').doc('startup').set({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      message: 'Server started'
    });
    console.log('Firestore connection test successful');
  } catch (error: any) {
    console.error('Firestore connection test failed:', error.message);
    if (error.message.includes('PERMISSION_DENIED')) {
      console.error('CRITICAL: Service account lacks permissions for database:', databaseId);
    }
  }
})();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Extend Request type for Firebase Auth
interface AuthRequest extends Request {
  user?: admin.auth.DecodedIdToken;
}

declare module "express-session" {
  interface SessionData {
    uid?: string;
  }
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
  const uri = `${APP_URL}/auth/callback`;
  console.log('Constructed Redirect URI:', uri);
  return uri;
};

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email'
];

const isProduction = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: APP_URL,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// AI Studio and Cloud Run are behind proxies
app.set('trust proxy', 1);

app.use(session({
  secret: SESSION_SECRET,
  resave: true,
  saveUninitialized: true,
  proxy: true, // Required when trust proxy is set and secure: true
  cookie: {
    secure: true, // Required for SameSite=None
    sameSite: 'none', // Required for cross-origin iframe/popup context
    httpOnly: true,
    maxAge: 15 * 60 * 1000
  }
}));

// Helper to get Google tokens for a user
async function getGoogleTokens(uid: string) {
  const tokenDoc = await firestore.collection('server_tokens').doc(uid).get();
  if (!tokenDoc.exists) {
    throw new Error('Google account not connected');
  }
  return tokenDoc.data();
}

// API Routes
app.get("/api/auth/url", authenticate, (req: AuthRequest, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  // Generate a signed state bound to the user
  const state = jwt.sign({ uid }, JWT_SECRET, { expiresIn: '15m' });

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    getRedirectUri()
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: state
  });
  res.json({ url: authUrl });
});

app.get("/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!state || !code) return res.status(400).send("Missing parameters");

  try {
    // Verify the state JWT
    const decoded = jwt.verify(state as string, JWT_SECRET) as { uid: string };
    const uid = decoded.uid;

    if (!uid) {
      console.error("OAuth State Error: No UID in token");
      return res.status(401).send("Authentication failed: Invalid state token.");
    }

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      getRedirectUri()
    );
    const { tokens } = await oauth2Client.getToken(code as string);
    
    // Store tokens securely in Firestore (server-side only)
    await firestore.collection('server_tokens').doc(uid).set(tokens);

    const appUrl = APP_URL.replace(/\/$/, '');

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              const targetOrigin = '${appUrl}' || window.location.origin;
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, targetOrigin);
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error("OAuth Callback Error:", {
      message: error.message,
      stack: error.stack,
      query: req.query
    });
    
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).send(`Authentication failed: Invalid or expired state token (${error.message})`);
    }
    
    res.status(401).send(`Authentication failed: ${error.message || "Invalid state or code"}`);
  }
});

// Clear Google Tokens (Force Reset)
app.post("/api/auth/clear", authenticate, async (req: AuthRequest, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  try {
    await firestore.collection('server_tokens').doc(uid).delete();
    await firestore.collection('users').doc(uid).update({ googleConnected: false });
    res.json({ success: true });
  } catch (error) {
    console.error('Error clearing tokens:', error);
    res.status(500).json({ error: 'Failed to clear tokens' });
  }
});

// Helper to handle Google API errors
function handleGoogleError(error: any, context: string, res: Response) {
  const message = error.message || '';
  const isProjectDeleted = message.includes('Project') && message.includes('deleted');
  const isAuthExpired = message.includes('invalid_grant') || message.includes('No refresh token');

  if (isProjectDeleted) {
    console.error(`[CRITICAL] ${context} failed: Google Cloud Project has been deleted. This is a configuration issue, not a bug.`);
    console.error(`Current Config Debug:
- APP_URL: ${APP_URL}
- GOOGLE_CLIENT_ID Prefix: ${GOOGLE_CLIENT_ID?.substring(0, 10)}...
- Redirect URI: ${getRedirectUri()}`);
    console.error(`To fix this, you MUST:
1. Create a NEW project in the Google Cloud Console (https://console.cloud.google.com/).
2. Enable Gmail, Calendar, and Drive APIs.
3. Create new OAuth 2.0 credentials.
4. Update GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your environment/secrets.
5. Disconnect and reconnect your Google account in the app.`);
    
    return res.status(500).json({ 
      error: 'Google Cloud Project Deleted',
      details: 'The Google Cloud Project associated with your OAuth credentials has been deleted. This usually happens if the project was a temporary trial or was manually removed. You must create a new project in the Google Cloud Console, enable the required APIs (Gmail, Calendar, Drive), and update your GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the app settings.'
    });
  }

  console.error(`${context} error:`, error);
  
  if (isAuthExpired) {
    return res.status(401).json({ 
      error: 'Authentication Expired',
      details: 'Your Google connection has expired or been revoked. Please disconnect and reconnect your Google account in Settings.'
    });
  }

  res.status(500).json({ error: `Failed to ${context.toLowerCase()}` });
}

// Gmail API - List messages
app.post("/api/gmail/list", authenticate, async (req: AuthRequest, res) => {
  const { query, pageToken, maxResults } = req.body;
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const tokens = await getGoogleTokens(uid);
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
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
    handleGoogleError(error, 'Gmail list', res);
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
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
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
    handleGoogleError(error, 'Gmail message', res);
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
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
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
    handleGoogleError(error, 'Calendar create', res);
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
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
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
    handleGoogleError(error, 'Calendar list', res);
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
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
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
    handleGoogleError(error, 'Drive ensure-folder', res);
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
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      getRedirectUri()
    );
    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const parsedUrl = new URL(url);
    const allowedHosts = ['drive.google.com', 'docs.google.com'];

    if (!allowedHosts.includes(parsedUrl.hostname)) {
      return res.status(400).json({ error: 'Unsupported file host' });
    }

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
    handleGoogleError(error, 'Drive save-url', res);
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
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
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
    handleGoogleError(error, 'Drive upload', res);
  }
});

async function startServer() {
  // Validate environment variables
  const requiredEnv = [
    'JWT_SECRET',
    'SESSION_SECRET',
    'APP_URL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET'
  ];

  for (const env of requiredEnv) {
    const value = process.env[env];
    if (!value) {
      throw new Error(`${env} environment variable is required`);
    }
    if (env === 'APP_URL' && !value.startsWith('http')) {
      throw new Error('APP_URL must be a valid URL starting with http:// or https://');
    }
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: false, // Explicitly disable HMR to avoid port 24678 conflicts
      },
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
app.post("/api/user/delete", authenticate, async (req: AuthRequest, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    // 1. Get user profile to find familyId
    const userDoc = await firestore.collection('users').doc(uid).get();
    const userData = userDoc.data();
    const familyId = userData?.familyId;
    const email = userData?.email;

    const batch = firestore.batch();

    // 2. Handle family membership
    if (familyId) {
      const familyRef = firestore.collection('families').doc(familyId);
      const familyDoc = await familyRef.get();
      const familyData = familyDoc.data();
      
      if (familyData && familyData.members) {
        const updatedMembers = familyData.members.filter((m: string) => m !== uid);
        if (updatedMembers.length === 0) {
          // Delete family and its events subcollection
          const eventsSnapshot = await familyRef.collection('events').get();
          eventsSnapshot.forEach(doc => batch.delete(doc.ref));
          batch.delete(familyRef);
        } else {
          // Just remove user from members
          batch.update(familyRef, { members: updatedMembers });
        }
      }
    }

    // 3. Delete invitations addressed to this user
    if (email) {
      const invitesForEmail = await firestore.collection('invitations')
        .where('email', '==', email)
        .get();

      invitesForEmail.forEach(inviteDoc => batch.delete(inviteDoc.ref));
    }

    // 4. Delete legacy user-scoped events if they still exist
    const legacyEventsSnapshot = await firestore.collection('users').doc(uid).collection('events').get();
    legacyEventsSnapshot.forEach(eventDoc => batch.delete(eventDoc.ref));

    // 5. Delete user profile
    const userRef = firestore.collection('users').doc(uid);
    batch.delete(userRef);

    // 6. Delete user tokens
    const tokensRef = firestore.collection('server_tokens').doc(uid);
    batch.delete(tokensRef);

    await batch.commit();

    // 7. Delete Firebase Auth account
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

startServer().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
