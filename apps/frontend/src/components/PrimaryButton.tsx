import React from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text} from 'react-native';

interface PrimaryButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}

function PrimaryButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
}: PrimaryButtonProps) {
  const isSecondary = variant === 'secondary';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({pressed}) => [
        styles.button,
        isSecondary ? styles.secondary : styles.primary,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={isSecondary ? '#0a84ff' : '#ffffff'} />
      ) : (
        <Text style={[styles.text, isSecondary && styles.secondaryText]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primary: {backgroundColor: '#0a84ff'},
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#0a84ff',
  },
  disabled: {opacity: 0.6},
  pressed: {opacity: 0.85},
  text: {color: '#ffffff', fontSize: 16, fontWeight: '600'},
  secondaryText: {color: '#0a84ff'},
});

export default PrimaryButton;
