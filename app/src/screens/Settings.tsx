import React, { useState } from 'react';
import { View, Text, TextInput, Button, Switch } from 'react-native';
import { useStore, modelToOllamaId } from '../store/useStore';

export default function Settings() {
  const { provider, model, mature, customOllamaModel, set } = useStore();
  const [prov, setProv] = useState(provider);
  const [mdl, setMdl] = useState(model);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [matureLang, setMatureLang] = useState(mature);
  const [customModel, setCustomModel] = useState(customOllamaModel || '');

  return (
    <View style={{flex:1, padding:12}}>
      <Text style={{fontSize:18, fontWeight:'700'}}>Settings</Text>
      <Text style={{marginTop:8}}>Provider: {prov}</Text>
      <View style={{flexDirection:'row', marginVertical:6}}>
        <Button title="Gemini" onPress={()=>setProv('gemini' as any)} />
        <View style={{width:8}} />
        <Button title="OpenAI" onPress={()=>setProv('openai' as any)} />
        <View style={{width:8}} />
        <Button title="Ollama (local)" onPress={()=>setProv('ollama' as any)} />
      </View>
      <Text>Model: {mdl}</Text>
      {prov==='gemini' && (
        <View style={{flexDirection:'row', marginVertical:6}}>
          <Button title="2.5 Flash" onPress={()=>setMdl('gemini-2.5-flash' as any)} />
          <View style={{width:8}} />
          <Button title="2.5 Flash-Lite" onPress={()=>setMdl('gemini-2.5-flash-lite' as any)} />
        </View>
      )}
      {prov==='ollama' && (
        <View style={{marginVertical:6}}>
          <View style={{flexDirection:'row', flexWrap:'wrap'}}>
            <Button title="Qwen2.5 7B" onPress={()=>setMdl('ollama-qwen2.5-7b-instruct' as any)} />
            <View style={{width:8}} />
            <Button title="Llama 3.1 8B" onPress={()=>setMdl('ollama-llama3.1-8b-instruct' as any)} />
            <View style={{width:8}} />
            <Button title="Hermes RP 8B" onPress={()=>setMdl('ollama-roleplay-hermes-3-llama-3.1-8b' as any)} />
          </View>
          <Text style={{marginTop:8}}>Custom Ollama model (optional)</Text>
          <TextInput value={customModel} onChangeText={setCustomModel} placeholder="e.g., qwen2.5:7b-instruct-q4_0"
            style={{borderWidth:1, borderColor:'#ccc', padding:8, borderRadius:6, marginTop:6}} />
        </View>
      )}
      <View style={{flexDirection:'row', alignItems:'center', marginTop:12}}>
        <Switch value={autoSwitch} onValueChange={setAutoSwitch} />
        <Text style={{marginLeft:8}}>Auto-switch to other free model on limit</Text>
      </View>
      <View style={{flexDirection:'row', alignItems:'center', marginTop:12}}>
        <Switch value={matureLang} onValueChange={setMatureLang} />
        <Text style={{marginLeft:8}}>Mature language (in-character)</Text>
      </View>
      <View style={{marginTop:12}}>
        <Button title="Save" onPress={()=> set({ provider: prov as any, model: mdl as any, mature: matureLang, customOllamaModel: customModel }) } />
      </View>
    </View>
  );
}
