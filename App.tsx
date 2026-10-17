import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { AuthProvider, useAuth } from './app/features/auth/AuthProvider';
import SignInScreen from './app/screens/SignInScreen';

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}

// Signed out -> sign in. Signed in -> straight to the camera.
function Root() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <SignInScreen />;

  // TODO(Caleb): replace with <CameraScreen />.
  return (
    <View style={styles.container}>
      <Text>Open up App.tsx to start working on your app!</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
