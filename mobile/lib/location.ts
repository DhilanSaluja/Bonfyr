import * as Location from 'expo-location';
import { Alert, Linking, Platform } from 'react-native';

export type LocationAccess = 'granted' | 'denied' | 'undetermined';

export async function getLocationAccess(): Promise<LocationAccess> {
  if (Platform.OS === 'web') return 'denied';
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') return 'granted';
    if (status === 'denied') return 'denied';
    return 'undetermined';
  } catch {
    return 'denied';
  }
}

/**
 * Ask for foreground location like a normal app:
 * explain why → system dialog → Settings if permanently denied.
 */
export async function requestLocationAccess(options?: {
  rationaleTitle?: string;
  rationaleMessage?: string;
}): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status === 'granted') return true;

    if (current.status === 'denied' && !current.canAskAgain) {
      return await promptOpenSettings(
        'Location access',
        'Location is turned off for Bonfyr. Enable it in Settings to drop a pin near you.'
      );
    }

    const title = options?.rationaleTitle ?? 'Use your location?';
    const message =
      options?.rationaleMessage ??
      'Bonfyr uses your location only when you share a meetup spot with a Spark. You can still search or tap the map without enabling it.';

    const proceed = await new Promise<boolean>((resolve) => {
      Alert.alert(title, message, [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ]);
    });
    if (!proceed) return false;

    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    console.warn('Location permission failed', e);
    Alert.alert(
      'Location unavailable',
      'Could not request location access. If you recently added location support, rebuild the development client and try again.'
    );
    return false;
  }
}

export async function getCurrentCoords(): Promise<{
  latitude: number;
  longitude: number;
} | null> {
  try {
    const access = await getLocationAccess();
    if (access !== 'granted') return null;

    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    };
  } catch (e) {
    console.warn('getCurrentPosition failed', e);
    return null;
  }
}

function promptOpenSettings(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      {
        text: 'Open Settings',
        onPress: async () => {
          await Linking.openSettings();
          resolve(false);
        },
      },
    ]);
  });
}
