// src/chat/chat.gateway.ts
import {
    WebSocketGateway,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
  } from '@nestjs/websockets';
  import { Server, Socket } from 'socket.io';
  
  interface User {
    id: string;
    username: string;
    socketId: string;
  }
  
  interface Group {
    name: string;
    members: string[]; // Array of usernames
  }
  
  @WebSocketGateway({
    cors: {
      origin: '*', // Update this with your frontend URL in production
    },
  })
  export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;
  
    private users: User[] = [];
    private groups: Group[] = [];
  
    // Handle new connection
    async handleConnection(client: Socket) {
      console.log(`Client connected: ${client.id}`);
    }
  
    // Handle disconnection
    async handleDisconnect(client: Socket) {
      // Remove user from users array
      const user = this.users.find(user => user.socketId === client.id);
      if (user) {
        this.users = this.users.filter(u => u.socketId !== client.id);
        console.log(`User ${user.username} disconnected`);
        
        // Remove user from all groups
        this.groups.forEach(group => {
          group.members = group.members.filter(member => member !== user.username);
        });
      }
    }
  
    // Register user with username
    @SubscribeMessage('register')
    handleRegister(
      @MessageBody() username: string,
      @ConnectedSocket() client: Socket,
    ) {
      // Check if username already exists
      const existingUser = this.users.find(user => user.username === username);
      if (existingUser) {
        // If username exists but with different socket (user reconnected)
        if (existingUser.socketId !== client.id) {
          existingUser.socketId = client.id;
          return { success: true, message: 'Reconnected successfully' };
        }
        return { success: false, message: 'Username already taken' };
      }
  
      // Add new user
      this.users.push({
        id: this.generateUserId(),
        username,
        socketId: client.id,
      });
  
      console.log(`User ${username} registered`);
      return { success: true, message: 'Registered successfully' };
    }
  
    // Send private message to specific user
    @SubscribeMessage('privateMessage')
    handlePrivateMessage(
      @MessageBody() data: { to: string; message: string },
      @ConnectedSocket() client: Socket,
    ) {
      const sender = this.users.find(user => user.socketId === client.id);
      if (!sender) {
        return { success: false, message: 'You are not registered' };
      }
  
      const recipient = this.users.find(user => user.username === data.to);
      if (!recipient) {
        return { success: false, message: 'Recipient not found' };
      }
  
      // Send to recipient
      this.server.to(recipient.socketId).emit('privateMessage', {
        from: sender.username,
        message: data.message,
        timestamp: new Date().toISOString(),
      });
  
      return { success: true, message: 'Message sent' };
    }
  
    // Create or join a group
    @SubscribeMessage('joinGroup')
    handleJoinGroup(
      @MessageBody() groupName: string,
      @ConnectedSocket() client: Socket,
    ) {
      const user = this.users.find(user => user.socketId === client.id);
      if (!user) {
        return { success: false, message: 'You are not registered' };
      }
  
      // Find or create group
      let group = this.groups.find(g => g.name === groupName);
      if (!group) {
        group = { name: groupName, members: [] };
        this.groups.push(group);
      }
  
      // Add user to group if not already a member
      if (!group.members.includes(user.username)) {
        group.members.push(user.username);
      }
  
      // Join the socket room for this group
      client.join(`group:${groupName}`);
  
      // Notify group members about the new user
      this.server.to(`group:${groupName}`).emit('groupNotification', {
        group: groupName,
        message: `${user.username} joined the group`,
        timestamp: new Date().toISOString(),
      });
  
      return { 
        success: true, 
        message: 'Joined group successfully', 
        members: group.members 
      };
    }
  
    // Leave a group
    @SubscribeMessage('leaveGroup')
    handleLeaveGroup(
      @MessageBody() groupName: string,
      @ConnectedSocket() client: Socket,
    ) {
      const user = this.users.find(user => user.socketId === client.id);
      if (!user) {
        return { success: false, message: 'You are not registered' };
      }
  
      const group = this.groups.find(g => g.name === groupName);
      if (!group) {
        return { success: false, message: 'Group not found' };
      }
  
      // Remove user from group
      group.members = group.members.filter(member => member !== user.username);
      
      // Leave the socket room
      client.leave(`group:${groupName}`);
  
      // Notify remaining members
      this.server.to(`group:${groupName}`).emit('groupNotification', {
        group: groupName,
        message: `${user.username} left the group`,
        timestamp: new Date().toISOString(),
      });
  
      return { success: true, message: 'Left group successfully' };
    }
  
    // Send message to a group
    @SubscribeMessage('groupMessage')
    handleGroupMessage(
      @MessageBody() data: { group: string; message: string },
      @ConnectedSocket() client: Socket,
    ) {
      const sender = this.users.find(user => user.socketId === client.id);
      if (!sender) {
        return { success: false, message: 'You are not registered' };
      }
  
      const group = this.groups.find(g => g.name === data.group);
      if (!group) {
        return { success: false, message: 'Group not found' };
      }
  
      // Check if user is a member of the group
      if (!group.members.includes(sender.username)) {
        return { success: false, message: 'You are not a member of this group' };
      }
  
      // Send to all group members
      this.server.to(`group:${data.group}`).emit('groupMessage', {
        group: data.group,
        from: sender.username,
        message: data.message,
        timestamp: new Date().toISOString(),
      });
  
      return { success: true, message: 'Group message sent' };
    }
  
    // Get list of online users
    @SubscribeMessage('getUsers')
    handleGetUsers() {
      return {
        users: this.users.map(u => u.username)
      };
    }
  
    // Get list of available groups
    @SubscribeMessage('getGroups')
    handleGetGroups() {
      return {
        groups: this.groups.map(g => ({
          name: g.name,
          memberCount: g.members.length
        }))
      };
    }
  
    // Get group details including members
    @SubscribeMessage('getGroupDetails')
    handleGetGroupDetails(@MessageBody() groupName: string) {
      const group = this.groups.find(g => g.name === groupName);
      if (!group) {
        return { success: false, message: 'Group not found' };
      }
  
      return {
        success: true,
        group: {
          name: group.name,
          members: group.members
        }
      };
    }
  
    // Helper method to generate user ID
    private generateUserId(): string {
      return Math.random().toString(36).substring(2, 15);
    }
  }