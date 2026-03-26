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

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required');
}

const APP_URL = process.env.APP_URL;
if (!APP_URL) {
  throw new Error('APP_URL environment variable is required');
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
if (!GOOGLE_CLIENT_ID) {
  throw new Error('GOOGLE_CLIENT_ID environment variable is required');
}

const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
if (!GOOGLE_CLIENT_SECRET) {
  throw new Error('GOOGLE_CLIENT_SECRET environment variable is required');
}

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: firebaseConfig.projectId,
  });
}

const firestore = firebaseConfig.firestoreDatabaseId 
  ? getFirestore(firebaseConfig.firestoreDatabaseId)
  : getFirestore();

const app = express();
const PORT = 3000;

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
  const baseUrl = APP_URL.replace(/\/$/, '');
  return `${baseUrl}/auth/callback`;
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

if (isProduction) {
  app.set('trust proxy', 1);
}

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
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

  // Store uid in session to prevent OAuth CSRF/Account Linking
  req.session.uid = uid; 

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    getRedirectUri()
  );

  // Generate a signed state bound to the user
  const state = jwt.sign({ uid }, JWT_SECRET, { expiresIn: '15m' });

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

    // Verify that the user finishing the flow is the same user who initiated it
    const sessionUid = req.session.uid;
    if (!sessionUid || sessionUid !== uid) {
      console.error("OAuth CSRF detected or session expired", { sessionUid, jwtUid: uid });
      return res.status(401).send("Authentication failed: Session mismatch or expired. Please try again.");
    }

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      getRedirectUri()
    );
    const { tokens } = await oauth2Client.getToken(code as string);
    
    // Store tokens securely in Firestore (server-side only)
    await firestore.collection('server_tokens').doc(uid).set(tokens);

    delete req.session.uid;

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
  } catch (error) {
    console.error("Error exchanging code for tokens or verifying state:", error);
    res.status(401).send("Authentication failed: Invalid state or code");
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
    console.error('Gmail list error:', error);
    res.status(500).json({ error: 'Failed to fetch Gmail messages' });
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
    console.error('Gmail message error:', error);
    res.status(500).json({ error: 'Failed to fetch Gmail message' });
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
    console.error('Calendar create error:', error);
    res.status(500).json({ error: 'Failed to create calendar event' });
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
    console.error('Calendar list error:', error);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
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
    console.error('Drive ensure-folder error:', error);
    res.status(500).json({ error: 'Failed to prepare Drive folder' });
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
    console.error('Drive save-url error:', error);
    res.status(500).json({ error: 'Failed to save file to Drive' });
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
    console.error('Drive upload error:', error);
    res.status(500).json({ error: 'Failed to upload file to Drive' });
  }
});

async function startServer() {
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

startServer();
