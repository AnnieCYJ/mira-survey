import React from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

export type EmotionFaceMood = 'excited' | 'happy' | 'calm' | 'stressed' | 'sad';

// The selector artwork is a soft, blurred organic “mood pebble”, rather than an emoji.
// These contours follow the five states shown in the reference interaction video.
export default function EmotionFaceIcon({ mood, color, size = 38 }: { mood: EmotionFaceMood; color: string; size?: number }) {
  const path = mood === 'calm'
    ? 'M12 2.3 C17.8 2.3 21.7 6.2 21.7 12 C21.7 17.8 17.8 21.7 12 21.7 C6.2 21.7 2.3 17.8 2.3 12 C2.3 6.2 6.2 2.3 12 2.3Z'
    : mood === 'sad'
      ? 'M12 1.6 L15.1 5.1 L19.6 3.9 L19.3 8.4 L22.8 11.2 L19.2 14.1 L19.8 18.6 L15.2 17.8 L12 22.3 L8.8 18 L4.2 18.7 L4.8 14.1 L1.2 11.3 L4.7 8.3 L4.4 3.9 L8.9 5.1Z'
      : mood === 'excited'
        ? 'M12 1.9 C14.7 1.7 15.1 4.7 17.4 5.1 C19.8 5.4 21.2 3.3 22.4 5.2 C23.7 7.3 20.9 8.8 21.6 11.1 C22.3 13.4 25 13.9 23.6 16 C22.2 18 19.6 16.4 17.9 18 C16.1 19.6 17.2 22.2 14.8 22.5 C12.4 22.8 11.8 20 9.5 19.7 C7.1 19.4 5.6 21.5 4.1 19.8 C2.5 18 5 16.1 4.2 13.9 C3.4 11.7 .8 11.3 1.9 9.1 C3 6.9 5.8 8.2 7.2 6.4 C8.7 4.6 7.3 2.1 9.5 1.7 C10.6 1.5 11.1 2 12 1.9Z'
        : 'M12 2 C14.5 1.8 15.2 4.1 17.1 4.5 C19.1 4.9 20.7 3.5 21.8 5.2 C22.8 6.9 20.8 8.4 21.2 10.4 C21.6 12.4 24 13.1 23.2 15 C22.4 16.9 19.9 16.5 18.7 18.1 C17.5 19.7 18.3 22 16.1 22.5 C13.9 23 12.6 20.8 10.6 20.8 C8.5 20.8 7.1 22.8 5.3 21.6 C3.5 20.4 4.8 18.2 3.5 16.6 C2.2 15 .1 15.1 .2 12.9 C.3 10.8 2.7 10.5 3.1 8.5 C3.5 6.4 1.9 4.7 3.5 3.4 C5.1 2.1 6.8 3.9 8.7 3.5 C10.6 3.1 10.6 2.2 12 2Z';
  const mouth = mood === 'excited' || mood === 'happy' ? 'M8.1 14.1 C10.1 16.7 13.9 16.7 15.9 14.1' : mood === 'sad' ? 'M8.3 15.9 C10.4 13.5 13.6 13.5 15.7 15.9' : 'M8.7 14.8 C10.8 15.4 13.2 15.4 15.3 14.8';
  const gradientId = `miraMood${mood}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0.72" />
          <Stop offset="0.58" stopColor={color} stopOpacity="1" />
          <Stop offset="1" stopColor={color} stopOpacity="0.76" />
        </LinearGradient>
      </Defs>
      <Path d={path} fill={`url(#${gradientId})`} />
      <Circle cx="8.6" cy="10.5" r="1.05" fill="#20243A" />
      <Circle cx="15.4" cy="10.5" r="1.05" fill="#20243A" />
      <Path d={mouth} fill="none" stroke="#20243A" strokeWidth="1.35" strokeLinecap="round" />
    </Svg>
  );
}
