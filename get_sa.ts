
async function getServiceAccount() {
  try {
    const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email', {
      headers: { 'Metadata-Flavor': 'Google' }
    });
    const email = await response.text();
    console.log('Service Account Email:', email);
  } catch (error: any) {
    console.error('Failed to get service account email:', error.message);
  }
}

getServiceAccount();
