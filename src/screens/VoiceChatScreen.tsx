import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import ChatSheet from '../components/ChatSheet';

interface Props {
  route: { params?: { question?: string } };
}

export default function VoiceChatScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const question = route.params?.question ?? '';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ChatSheet
        visible={true}
        onClose={() => navigation.goBack()}
        initialQuestion={question}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
