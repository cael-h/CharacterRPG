import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, FlatList, TouchableOpacity } from 'react-native';
import { useStore } from '../store/useStore';

export default function Characters() {
  const { apiBase, characters, selected, set } = useStore();
  const [name, setName] = useState('Olive');
  const [systemPrompt, setSystemPrompt] = useState('You are Olive.');

  const load = async () => {
    try {
      const rows = await fetch(`${apiBase}/api/characters`).then(r=>r.json());
      set({ characters: rows });
    } catch {}
  };

  useEffect(()=>{ load(); }, []);

  const create = async () => {
    await fetch(`${apiBase}/api/characters`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, system_prompt: systemPrompt }) }).then(r=>r.json());
    await load();
  };

  return (
    <View style={{flex:1, padding:12}}>
      <Text style={{fontSize:18, fontWeight:'700'}}>Characters</Text>
      <FlatList data={characters} keyExtractor={(item:any)=>item.id}
        renderItem={({item})=> {
          const isSel = selected.includes(item.id);
          return (
            <TouchableOpacity onPress={()=> set({ selected: isSel ? selected.filter(id=>id!==item.id) : [...selected, item.id] }) }>
              <View style={{paddingVertical:8, flexDirection:'row', justifyContent:'space-between'}}>
                <Text style={{fontWeight:'600'}}>{item.name}</Text>
                <Text>{isSel ? 'Selected' : 'Tap to select'}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
      <View style={{marginTop:12}}>
        <Text style={{fontWeight:'600'}}>Add Character</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Name" style={{borderWidth:1, borderColor:'#ccc', padding:8, borderRadius:6, marginVertical:6}} />
        <TextInput value={systemPrompt} onChangeText={setSystemPrompt} placeholder="System prompt" style={{borderWidth:1, borderColor:'#ccc', padding:8, borderRadius:6, marginVertical:6}} />
        <Button title="Create" onPress={create} />
      </View>
    </View>
  );
}
