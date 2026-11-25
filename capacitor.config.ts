import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tarunh.vouch',
  appName: 'Vouch',
  webDir: 'public',
  server: {
    url: process.env.NODE_ENV === 'production'
      ? 'https://tas.tarunh.com'
      : 'http://192.168.178.180:3000',
    cleartext: true,
    androidScheme: 'https'
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: 'LIGHT',
      backgroundColor: '#000000'
    }
  }
};

export default config;
