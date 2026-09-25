import React from 'react';
import {StyleSheet, Text, TextInput, TextInputProps, View} from 'react-native';

interface FormFieldProps extends TextInputProps {
  label: string;
  error?: string;
}

function FormField({label, error, style, ...inputProps}: FormFieldProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, error ? styles.inputError : null, style]}
        placeholderTextColor="#8a8a8a"
        autoCapitalize="none"
        {...inputProps}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {marginBottom: 16},
  label: {marginBottom: 6, fontSize: 14, fontWeight: '600', color: '#1c1c1e'},
  input: {
    borderWidth: 1,
    borderColor: '#c7c7cc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#1c1c1e',
  },
  inputError: {borderColor: '#d70015'},
  error: {marginTop: 4, color: '#d70015', fontSize: 13},
});

export default FormField;
