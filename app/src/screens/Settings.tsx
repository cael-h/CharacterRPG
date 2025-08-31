import React, { useState } from 'react';
import { View, Text, TextInput, Button, Switch } from 'react-native';
import { useStore } from '../store/useStore';

export default function Settings() {
  const { provider, model, set } = useStore();
  const [prov, setProv] = useState(provider);
  const [mdl, setMdl] = useState(model);
  const [autoSwitch, setAutoSwitch] = useState(true);

  return (
    <View style={{flex:1, padding:12}}>
      <Text style={{fontSize:18, fontWeight:'700'}}>Settings</Text>
      <Text style={{marginTop:8}}>Provider: {prov}</Text>
      <View style={{flexDirection:'row', marginVertical:6}}>
        <Button title="Gemini" onPress={()=>setProv('gemini' as any)} />
        <View style={{width:8}} />
        <Button title="OpenAI" onPress={()=>setProv('openai' as any)} />
      </View>
      <Text>Model: {mdl}</Text>
      <View style={{flexDirection:'row', marginVertical:6}}>
        <Button title="2.5 Flash" onPress={()=>setMdl('gemini-2.5-flash' as any)} />
        <View style={{width:8}} />
        <Button title="2.5 Flash-Lite" onPress={()=>setMdl('gemini-2.5-flash-lite' as any)} />
      </View>
      <View style={{flexDirection:'row', alignItems:'center', marginTop:12}}>
        <Switch value={autoSwitch} onValueChange={setAutoSwitch} />
        <Text style={{marginLeft:8}}>Auto-switch to other free model on limit</Text>
      </View>
      <View style={{marginTop:12}}>
        <Button title="Save" onPress={()=> set({ provider: prov as any, model: mdl as any }) } />
      </View>
    </View>
  );
}

