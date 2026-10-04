import { Stack } from 'expo-router';
import { useAppTheme } from '@/lib/theme-context';

export default function AuthLayout() {
  const { colors } = useAppTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.paper },
        animation: 'slide_from_right',
        animationDuration: 200,
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="create-account" />
      <Stack.Screen name="contacts-permission" />
    </Stack>
  );
}
