import React from 'react';
import { View, Text, Button } from 'react-native';
import { useStore } from './src/store/useStore';
import Conversation from './src/screens/Conversation';
import Characters from './src/screens/Characters';
import Settings from './src/screens/Settings';

export default function App() {
  const { set } = useStore();
  const [screen, setScreen] = React.useState<'characters'|'conversation'|'settings'>('characters');
  return (
    <View style={{flex:1}}>
      <View style={{flexDirection:'row', justifyContent:'space-around', paddingTop:40, paddingBottom:8, borderBottomWidth:1, borderColor:'#eee'}}>
        <Button title="Characters" onPress={()=>setScreen('characters')} />
        <Button title="Conversation" onPress={()=>setScreen('conversation')} />
        <Button title="Settings" onPress={()=>setScreen('settings')} />
      </View>
      <View style={{flex:1}}>
        {screen==='characters' && <Characters />}
        {screen==='conversation' && <Conversation />}
        {screen==='settings' && <Settings />}
      </View>
    </View>
  );
}

