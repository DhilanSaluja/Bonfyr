import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Platform,
  TextInput,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { radii, spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import {
  getCurrentCoords,
  getLocationAccess,
  requestLocationAccess,
} from '@/lib/location';
import {
  getPlaceDetails,
  hasPlacesApiKey,
  searchPlaces,
  type PlaceSuggestion,
} from '@/lib/places';
import { MapErrorBoundary } from '@/components/MapErrorBoundary';

/** Fallback when GPS isn't available; still lets users search / tap a pin. */
const DEFAULT_REGION = {
  latitude: 39.8283,
  longitude: -98.5795,
  latitudeDelta: 25,
  longitudeDelta: 25,
};

export type MeetupPlace = {
  latitude: number;
  longitude: number;
  title: string;
  address: string;
};

export function MeetupLocationPicker({
  onSelect,
}: {
  onSelect: (place: MeetupPlace) => void;
}) {
  const { colors, styles } = useThemedStyles(makeStyles);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<MeetupPlace | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadLocation = useCallback(async (askPermission: boolean) => {
    setLoading(true);
    try {
      let granted = (await getLocationAccess()) === 'granted';
      if (!granted && askPermission) {
        granted = await requestLocationAccess();
      }

      if (!granted) {
        setPermissionDenied(true);
        setUserLocation(null);
        return;
      }

      const coords = await getCurrentCoords();
      if (coords) {
        setUserLocation(coords);
        setPermissionDenied(false);
      } else {
        setPermissionDenied(false);
        setUserLocation(null);
      }
    } catch (e) {
      console.warn('MeetupLocationPicker load failed', e);
      setPermissionDenied(true);
      setUserLocation(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLocation(true);
  }, [loadLocation]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);

    const q = searchQuery.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }

    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      const results = await searchPlaces(q, userLocation ?? undefined);
      setSuggestions(results);
      setSearching(false);
    }, 350);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery, userLocation]);

  const choose = (place: MeetupPlace) => {
    setSelectedPlace(place);
    setSearchQuery(place.title);
    setSuggestions([]);
    onSelect(place);
  };

  const pickSuggestion = async (suggestion: PlaceSuggestion) => {
    setSearching(true);
    const details = await getPlaceDetails(suggestion.placeId);
    setSearching(false);
    if (details) {
      choose(details);
    }
  };

  const mapCenter = userLocation ?? {
    latitude: selectedPlace?.latitude ?? DEFAULT_REGION.latitude,
    longitude: selectedPlace?.longitude ?? DEFAULT_REGION.longitude,
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.lamp} />
        <Text style={styles.loadingText}>Finding your location…</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {permissionDenied || !userLocation ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {permissionDenied
              ? 'Location permission is off. Enable it to center on you, or search / tap the map.'
              : 'Couldn’t get GPS. Search a place or tap the map to drop a pin.'}
          </Text>
          <Pressable style={styles.bannerBtn} onPress={() => loadLocation(true)}>
            <Text style={styles.bannerBtnText}>Enable location</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.searchBox}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search meetup spot near you…"
          placeholderTextColor={colors.charcoalMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
        />
        {searching ? (
          <ActivityIndicator size="small" color={colors.lamp} style={styles.searchSpinner} />
        ) : null}
        {suggestions.length > 0 ? (
          <View style={styles.suggestions}>
            {suggestions.map((s) => (
              <Pressable
                key={s.placeId}
                style={styles.suggestionRow}
                onPress={() => pickSuggestion(s)}
              >
                <Text style={styles.suggestionMain}>{s.mainText}</Text>
                {s.secondaryText ? (
                  <Text style={styles.suggestionSub}>{s.secondaryText}</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {!mapFailed ? (
        <View style={styles.mapBox}>
          <MapErrorBoundary onError={() => setMapFailed(true)}>
            <MapView
              style={StyleSheet.absoluteFill}
              provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
              initialRegion={{
                latitude: mapCenter.latitude,
                longitude: mapCenter.longitude,
                latitudeDelta: userLocation ? 0.02 : DEFAULT_REGION.latitudeDelta,
                longitudeDelta: userLocation ? 0.02 : DEFAULT_REGION.longitudeDelta,
              }}
              region={
                selectedPlace
                  ? {
                      latitude: selectedPlace.latitude,
                      longitude: selectedPlace.longitude,
                      latitudeDelta: 0.01,
                      longitudeDelta: 0.01,
                    }
                  : undefined
              }
              showsUserLocation={!!userLocation}
              onPress={(e) => {
                const { latitude, longitude } = e.nativeEvent.coordinate;
                choose({
                  latitude,
                  longitude,
                  title: 'Pinned spot',
                  address: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
                });
              }}
            >
              {selectedPlace && (
                <Marker
                  coordinate={{
                    latitude: selectedPlace.latitude,
                    longitude: selectedPlace.longitude,
                  }}
                  title={selectedPlace.title}
                  description={selectedPlace.address}
                />
              )}
            </MapView>
          </MapErrorBoundary>
        </View>
      ) : (
        <View style={styles.mapFallback}>
          <Text style={styles.mapFallbackText}>
            Map couldn’t load. Use search above to pick a spot.
          </Text>
        </View>
      )}

      {selectedPlace ? (
        <Text style={styles.resolved}>
          Using: {selectedPlace.title}
          {selectedPlace.address ? ` · ${selectedPlace.address}` : ''}
        </Text>
      ) : (
        <Text style={styles.hint}>Search a place or tap the map to drop a pin.</Text>
      )}
      {!hasPlacesApiKey() ? (
        <Text style={styles.hint}>
          Add EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to enable place search.
        </Text>
      ) : null}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  wrap: { gap: spacing.sm },
  loading: {
    width: '100%',
    aspectRatio: 1.6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paperDeep,
    borderRadius: radii.lg,
  },
  loadingText: { ...typography.caption, color: colors.charcoalMuted, marginTop: spacing.sm },
  banner: {
    backgroundColor: colors.paperDeep,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  bannerText: { ...typography.caption, color: colors.charcoalSoft, lineHeight: 22, paddingBottom: 2 },
  bannerBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.lampBtn,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  bannerBtnText: { ...typography.caption, color: colors.ink, fontWeight: '600' },
  searchBox: {
    position: 'relative',
    zIndex: 10,
  },
  searchInput: {
    height: 44,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    fontSize: 15,
    backgroundColor: colors.warmWhite,
    color: colors.charcoal,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  searchSpinner: {
    position: 'absolute',
    right: 12,
    top: 12,
  },
  suggestions: {
    backgroundColor: colors.warmWhite,
    borderRadius: radii.md,
    marginTop: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  suggestionRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  suggestionMain: { ...typography.body, color: colors.charcoal },
  suggestionSub: { ...typography.caption, color: colors.charcoalMuted, marginTop: 2 },
  mapBox: {
    width: '100%',
    aspectRatio: 1.55,
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  mapFallback: {
    width: '100%',
    aspectRatio: 2.8,
    borderRadius: radii.lg,
    backgroundColor: colors.paperDeep,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  mapFallbackText: {
    ...typography.caption,
    color: colors.charcoalMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  resolved: { ...typography.caption, color: colors.success },
  hint: { ...typography.caption, color: colors.charcoalMuted },
  });
}
