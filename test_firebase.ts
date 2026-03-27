
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "./firebase-applet-config.json" assert { type: "json" };

async function test() {
  try {
    console.log('Initializing Firebase Admin for project:', firebaseConfig.projectId);
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: firebaseConfig.projectId,
    });

    const databaseId = '(default)';
    console.log('Using Firestore Database ID:', databaseId);
    const firestore = getFirestore(databaseId);

    console.log('Attempting to write to Firestore...');
    await firestore.collection('system_check').doc('manual_test').set({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      message: 'Manual test from script'
    });
    console.log('Firestore write successful!');

    console.log('Attempting to read from Firestore...');
    const doc = await firestore.collection('system_check').doc('manual_test').get();
    console.log('Firestore read successful! Data:', doc.data());

    process.exit(0);
  } catch (error: any) {
    console.error('Firestore test failed!');
    console.error('Error Code:', error.code);
    console.error('Error Message:', error.message);
    if (error.stack) console.error('Stack Trace:', error.stack);
    process.exit(1);
  }
}

test();
