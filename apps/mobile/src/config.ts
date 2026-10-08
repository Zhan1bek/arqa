import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * API base URL:
 * 1. EXPO_PUBLIC_API_URL if set (e.g. a deployed server);
 * 2. on a phone in Expo Go — the dev machine's LAN IP taken from the Metro host, port 3000;
 * 3. otherwise localhost:3000.
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  const metroHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (Platform.OS !== 'web' && metroHost) return `http://${metroHost}:3000`;

  return 'http://localhost:3000';
}

export const API_URL = resolveApiUrl();
