/**
 * PulseGrid Gesture Piano Feature Module
 *
 * This module encapsulates the camera-controlled, MediaPipe hand-tracking
 * musical instrument for PulseGrid.
 *
 * It is decoupled from the active DAW UI while preserving the entire
 * audio engine, kinematics pipeline, and UI views intact for future reintroduction.
 */

export { GesturePianoView } from '../../components/GesturePianoView';
export { GesturePianoKeyboard } from '../../components/GesturePianoKeyboard';
export { GesturePianoBottomDock } from '../../components/GesturePianoBottomDock';

export type {
  GesturePianoConfig,
  GestureInstrumentMode,
  KeyboardSpanMode,
  VelocityMode,
  GestureMidiEvent,
  FingerRuntimeState,
} from '../../vision/gestureKinematicsCore';

export {
  GestureKinematicsProcessor,
  mapFingerToMidiPitch,
} from '../../vision/gestureKinematicsCore';

export { FingerPianoEngine } from '../../vision/fingerPianoEngine';
export { HandTrackingEngine } from '../../vision/handTrackingEngine';
