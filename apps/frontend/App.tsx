/**
 * QuestBoard
 * Sign up, log in, and manage a user profile against the backend API.
 *
 * @format
 */

import React from 'react';
import {StatusBar, StyleSheet, useColorScheme, View} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import TestScreen from './src/screens/TestScreen';
import {AppProvider} from './src/state/AppContext';

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();

  return (
    <View style={[styles.container, {paddingTop: safeAreaInsets.top}]}>
      <TestScreen />
    </View>
  );
}

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <AppContent />
      </AppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
});

export default App;
