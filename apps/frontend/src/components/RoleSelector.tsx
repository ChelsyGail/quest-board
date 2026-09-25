import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';

import {UserRole} from '../api';

const ALL_ROLES: UserRole[] = ['student', 'organizer', 'moderator'];

interface RoleSelectorProps {
  selected: UserRole[];
  onChange: (roles: UserRole[]) => void;
}

function RoleSelector({selected, onChange}: RoleSelectorProps) {
  function toggleRole(role: UserRole) {
    if (selected.includes(role)) {
      onChange(selected.filter(item => item !== role));
    } else {
      onChange([...selected, role]);
    }
  }

  return (
    <View style={styles.row}>
      {ALL_ROLES.map(role => {
        const isSelected = selected.includes(role);
        return (
          <Pressable
            key={role}
            onPress={() => toggleRole(role)}
            style={[styles.chip, isSelected && styles.chipSelected]}>
            <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
              {role}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8},
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#c7c7cc',
  },
  chipSelected: {backgroundColor: '#0a84ff', borderColor: '#0a84ff'},
  chipText: {fontSize: 14, color: '#1c1c1e'},
  chipTextSelected: {color: '#ffffff'},
});

export default RoleSelector;
