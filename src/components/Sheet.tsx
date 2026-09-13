import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Animated,
  View,
  TouchableWithoutFeedback,
  StyleSheet,
  Easing,
  Text,
  Dimensions,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme/theme';
import Icon from './Icon';

interface Props {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  style?: ViewStyle;
}

export default function Sheet({ visible, onClose, children, style }: Props) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const tx = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(tx, {
      toValue: visible ? 0 : 1,
      duration: theme.motion.durL,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start(() => {
      if (!visible) setMounted(false);
    });
  }, [visible, tx]);

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <Animated.View
        style={[
          styles.panel,
          style,
          {
            top: insets.top,
            transform: [
              {
                translateX: tx.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, Dimensions.get('window').width],
                }),
              },
            ],
          },
        ]}
      >
        {children}
      </Animated.View>
    </Modal>
  );
}

export function SheetHead({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.head}>
      <TouchableWithoutFeedback onPress={onBack}>
        <View style={styles.back}>
          <Icon
            name="back"
            size={theme.fs(22)}
            color={theme.colors.textTitle}
            strokeWidth={2.2}
          />
        </View>
      </TouchableWithoutFeedback>
      <View style={styles.headText}>
        <Text style={styles.sheetTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sheetSub}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.colors.overlay },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.bgMid,
    borderTopLeftRadius: theme.radius.card,
    borderBottomLeftRadius: theme.radius.card,
    ...theme.shadow.sheet,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.space.screen,
    paddingTop: theme.space.xl,
    paddingBottom: theme.space.sm,
  },
  back: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
    marginRight: theme.space.sm,
  },
  headText: { flex: 1 },
  sheetTitle: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  sheetSub: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.sp(1),
  },
});
