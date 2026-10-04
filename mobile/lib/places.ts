const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

export type PlaceSuggestion = {
  placeId: string;
  mainText: string;
  secondaryText: string;
};

export type PlaceDetails = {
  latitude: number;
  longitude: number;
  title: string;
  address: string;
};

export async function searchPlaces(
  input: string,
  location?: { latitude: number; longitude: number }
): Promise<PlaceSuggestion[]> {
  if (!GOOGLE_PLACES_API_KEY || input.trim().length < 2) return [];

  const params = new URLSearchParams({
    input: input.trim(),
    key: GOOGLE_PLACES_API_KEY,
    language: 'en',
  });

  if (location) {
    params.set('location', `${location.latitude},${location.longitude}`);
    params.set('radius', '20000');
  }

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`
    );
    const data = await res.json();
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.warn('Places autocomplete:', data.status, data.error_message);
      return [];
    }

    return (data.predictions ?? []).slice(0, 5).map(
      (p: {
        place_id: string;
        structured_formatting: { main_text: string; secondary_text?: string };
      }) => ({
        placeId: p.place_id,
        mainText: p.structured_formatting.main_text,
        secondaryText: p.structured_formatting.secondary_text ?? '',
      })
    );
  } catch (e) {
    console.warn('Places search failed', e);
    return [];
  }
}

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  if (!GOOGLE_PLACES_API_KEY) return null;

  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'geometry,name,formatted_address',
    key: GOOGLE_PLACES_API_KEY,
  });

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`
    );
    const data = await res.json();
    if (data.status !== 'OK' || !data.result?.geometry?.location) {
      console.warn('Places details:', data.status, data.error_message);
      return null;
    }

    const { lat, lng } = data.result.geometry.location;
    return {
      latitude: lat,
      longitude: lng,
      title: data.result.name ?? 'Selected place',
      address: data.result.formatted_address ?? '',
    };
  } catch (e) {
    console.warn('Places details failed', e);
    return null;
  }
}

export function hasPlacesApiKey(): boolean {
  return GOOGLE_PLACES_API_KEY.length > 0;
}
